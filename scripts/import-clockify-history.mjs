#!/usr/bin/env node
// H18 (docs/audit-findings.md): one-time Clockify → IronTrack historical import.
//
// This is deliberately a throwaway script, not a permanent feature — per H18's own
// recommendation, run it once during cutover, confirm the result, then delete this file.
// It does NOT belong in any npm script or CI step.
//
// USAGE
//   1. Dry run (default, no writes, safe to run repeatedly):
//        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//        node scripts/import-clockify-history.mjs "path/to/export.csv"
//
//      Without credentials it still runs an "offline" structural check of the CSV
//      itself (parse errors, distinct emails/projects/tags, date range) so the file
//      can be sanity-checked before anyone has to touch the database at all.
//
//   2. Actually write the matched rows:
//        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//        node scripts/import-clockify-history.mjs "path/to/export.csv" --commit
//
//   Optional flags:
//     --fallback-timezone=Australia/Sydney   used only for a row whose matched user
//                                             has no profiles.timezone set (shouldn't
//                                             happen — the column defaults to this
//                                             same value — but kept explicit rather
//                                             than silently assumed)
//     --mapping=path/to/mapping.json         override file for names that don't match
//                                             exactly, shape:
//                                             { "users": { "clockify@email.com": "irontrack@email.com" },
//                                               "projects": { "Clockify Project Name": "IronTrack Project Name" } }
//     --allow-unmatched-projects              import a row whose Project doesn't match any
//                                             IronTrack project anyway, with project_id left
//                                             null, instead of skipping it — recovers the
//                                             hours/description/person even when nobody's
//                                             gotten around to creating or mapping every
//                                             historical project. Does NOT apply to an
//                                             unmatched *person* — there's no equivalent
//                                             fallback for user_id, which is NOT NULL.
//
// CREDENTIALS
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — the service-role key, not the anon key.
//   This deliberately bypasses RLS (same pattern src/lib/admin.functions.ts already uses
//   for privileged, admin-only operations) because a bulk historical backfill is not a
//   live user action and shouldn't be shaped by per-request RLS — the DB's own table-level
//   constraints (the no-overlap EXCLUDE constraint, the one-running-timer index, the
//   duration_minutes trigger) still apply regardless, since those aren't RLS.
//   Get the service-role key from the Supabase dashboard → Project Settings → API — never
//   commit it, never put it in .env, pass it as an env var for this one run only.
//
// WHAT THIS DOES NOT DO
//   - Does not create missing users or projects, ever. An unmatched email/project name is
//     always reported. An unmatched *email* is always skipped — there's no fallback for
//     user_id, which is NOT NULL. An unmatched *project* is skipped by default too, unless
//     --allow-unmatched-projects is passed, in which case that row still imports with
//     project_id left null rather than being lost. Neither path ever guesses at or invents
//     a new user/project row.
//   - Does not attempt to detect near-duplicate/overlapping entries itself beyond an
//     exact-duplicate check within the file — the database's own overlap constraint is
//     the real backstop, and a per-row rejection from it is reported as a skip, not a
//     crash.
//   - Does not touch `timesheets` at all — imported entries land as ordinary, unsubmitted
//     time_entries, same as anything a person would have logged themselves. Whether past
//     weeks get submitted/approved after import is a separate decision, not this script's.

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    commit: false,
    fallbackTimezone: "Australia/Sydney",
    mapping: null,
    csvPath: null,
    allowUnmatchedProjects: false,
  };
  for (const arg of argv) {
    if (arg === "--commit") args.commit = true;
    else if (arg === "--allow-unmatched-projects") args.allowUnmatchedProjects = true;
    else if (arg.startsWith("--fallback-timezone=")) args.fallbackTimezone = arg.split("=")[1];
    else if (arg.startsWith("--mapping=")) args.mapping = arg.split("=")[1];
    else if (!arg.startsWith("--")) args.csvPath = arg;
  }
  return args;
}

// ---------------------------------------------------------------------------
// CSV parsing — Clockify's "Detailed" export quotes every field, so this
// only needs to handle quoted fields (with embedded commas) and the RFC4180
// `""` escape for a literal quote inside a field. No external dependency.
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const lines = text.split(/\r\n|\n/);
  for (const rawLine of lines) {
    if (rawLine === "" && !inQuotes && row.length === 0 && field === "") continue;
    const line = rawLine;
    let i = 0;
    if (inQuotes) {
      // continuing a field that had an embedded newline
      field += "\n";
    }
    while (i < line.length) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    if (!inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    }
  }
  if (row.length || field) rows.push([...row, field]);

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((r) => r.length === header.length && r.some((c) => c !== ""))
    .map((r, idx) => {
      const obj = {};
      header.forEach((h, i) => (obj[h] = r[i]));
      obj.__line = idx + 2; // +1 for header, +1 for 1-indexing
      return obj;
    });
}

// ---------------------------------------------------------------------------
// Timezone-aware date handling — Node has no "interpret this wall-clock time
// as timezone X" primitive, so this derives it from Intl.DateTimeFormat: guess
// the UTC instant equal to the wall-clock numbers, see what that instant
// displays as in the target zone, and correct by the difference. Standard,
// dependency-free technique; correct for all but the literal DST-transition
// instant itself, which doesn't matter here.
// ---------------------------------------------------------------------------

function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map((p) => [p.type, p.value]));
  const asIfLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = asIfLocal - guess.getTime();
  return new Date(guess.getTime() - offset);
}

function zonedDateKey(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date); // en-CA gives YYYY-MM-DD directly
}

function zonedMidnightAfter(date, timeZone) {
  // The next local midnight in `timeZone`, strictly after `date`, expressed as a UTC Date.
  const key = zonedDateKey(date, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  const midnightSameDay = zonedTimeToUtc(y, m, d, 0, 0, 0, timeZone);
  if (midnightSameDay > date) return midnightSameDay;
  const [ny, nm, nd] = zonedDateKey(new Date(date.getTime() + 24 * 60 * 60 * 1000), timeZone)
    .split("-")
    .map(Number);
  return zonedTimeToUtc(ny, nm, nd, 0, 0, 0, timeZone);
}

/** Same invariant as src/lib/time-utils.ts's splitByDay (H8/M21), timezone-aware. */
function splitByDayInZone(start, end, timeZone) {
  const segments = [];
  let segStart = start;
  while (segStart < end) {
    const dayEnd = zonedMidnightAfter(segStart, timeZone);
    const segEnd = dayEnd < end ? dayEnd : end;
    segments.push({
      date: zonedDateKey(segStart, timeZone),
      start: segStart,
      end: segEnd,
      minutes: Math.max(1, Math.round((segEnd.getTime() - segStart.getTime()) / 60000)),
    });
    segStart = segEnd;
  }
  return segments;
}

function parseClockifyDateTime(dateStr, timeStr, timeZone) {
  // Clockify's export uses DD/MM/YYYY.
  const [d, mo, y] = dateStr.split("/").map(Number);
  const [h, mi, s] = timeStr.split(":").map(Number);
  if (!d || !mo || !y || Number.isNaN(h) || Number.isNaN(mi)) return null;
  return zonedTimeToUtc(y, mo, d, h, mi, s || 0, timeZone);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csvPath) {
    console.error("Usage: node scripts/import-clockify-history.mjs <path-to-csv> [--commit]");
    process.exit(1);
  }

  const raw = await readFile(args.csvPath, "utf8");
  const rows = parseCsv(raw);
  console.log(`Parsed ${rows.length} data row(s) from ${args.csvPath}.`);

  let mapping = { users: {}, projects: {} };
  if (args.mapping) {
    mapping = JSON.parse(await readFile(args.mapping, "utf8"));
    console.log(
      `Loaded mapping overrides: ${Object.keys(mapping.users ?? {}).length} user(s), ` +
        `${Object.keys(mapping.projects ?? {}).length} project(s).`,
    );
  }

  // --- Offline structural summary — always runs, no credentials needed ---
  const distinctEmails = [
    ...new Set(rows.map((r) => (r.Email ?? "").trim().toLowerCase()).filter(Boolean)),
  ];
  const distinctProjects = [...new Set(rows.map((r) => (r.Project ?? "").trim()).filter(Boolean))];
  const distinctTags = [
    ...new Set(rows.flatMap((r) => (r.Tags ?? "").split(",").map((t) => t.trim())).filter(Boolean)),
  ];
  const dates = rows
    .map((r) => parseClockifyDateTime(r["Start Date"], r["Start Time"], args.fallbackTimezone))
    .filter(Boolean)
    .sort((a, b) => a - b);
  // Format back through the same zone, not .toISOString() — a UTC instant for a
  // Sydney-morning timestamp falls on the *previous* UTC calendar day, which would
  // otherwise misreport this range as one day earlier than the CSV's own dates.
  console.log(
    `Date range: ${dates[0] ? zonedDateKey(dates[0], args.fallbackTimezone) : "n/a"} to ` +
      `${dates.length ? zonedDateKey(dates.at(-1), args.fallbackTimezone) : "n/a"} (interpreted ` +
      `using ${args.fallbackTimezone} pending per-user timezone lookup below).`,
  );
  console.log(`Distinct emails in file: ${distinctEmails.length}`);
  console.log(`Distinct Clockify project names in file: ${distinctProjects.length}`);
  console.log(`Distinct tags in file: ${distinctTags.length}`);
  const unparseableRows = rows.filter(
    (r) => !parseClockifyDateTime(r["Start Date"], r["Start Time"], args.fallbackTimezone),
  );
  if (unparseableRows.length) {
    console.warn(
      `${unparseableRows.length} row(s) have an unparseable date/time (lines: ` +
        `${unparseableRows.map((r) => r.__line).join(", ")}) — these will be skipped.`,
    );
  }

  // Sanity check: sum our own computed (end - start) duration against Clockify's own
  // "Duration (decimal)" column for the same rows. These should agree almost exactly —
  // a real mismatch here means the date/time parsing itself is wrong (e.g. a DST
  // boundary miscalculated, or AM/PM confusion), not just a display issue, and is worth
  // catching before anything is matched against real people/projects, let alone written.
  let computedMinutes = 0;
  let reportedHours = 0;
  for (const r of rows) {
    const start = parseClockifyDateTime(r["Start Date"], r["Start Time"], args.fallbackTimezone);
    const end = parseClockifyDateTime(r["End Date"], r["End Time"], args.fallbackTimezone);
    const decimal = Number(r["Duration (decimal)"]);
    if (start && end && end > start && !Number.isNaN(decimal)) {
      computedMinutes += (end.getTime() - start.getTime()) / 60000;
      reportedHours += decimal;
    }
  }
  const computedHours = computedMinutes / 60;
  const driftHours = Math.abs(computedHours - reportedHours);
  console.log(
    `Duration sanity check: computed ${computedHours.toFixed(2)}h vs Clockify's own reported ` +
      `${reportedHours.toFixed(2)}h across all rows (drift: ${driftHours.toFixed(2)}h).`,
  );
  if (driftHours > Math.max(0.5, reportedHours * 0.01)) {
    console.warn(
      "  ^ That drift is larger than rounding alone would explain — double-check the date/time " +
        "parsing (and --fallback-timezone) before trusting the match report below.",
    );
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "\nNo SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment — stopping here. " +
        "This was an offline structural check only; nothing was matched against the " +
        "database and nothing was written. Re-run with those two env vars set (service-role " +
        "key, not the anon key) to match users/projects and see what would actually import.",
    );
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // --- Fetch what we need to match against ---
  const [
    { data: profiles, error: profilesErr },
    { data: projects, error: projectsErr },
    { data: tags, error: tagsErr },
  ] = await Promise.all([
    supabase.from("profiles").select("id, email, timezone"),
    supabase.from("projects").select("id, name, is_billable, is_archived"),
    supabase.from("tags").select("id, name"),
  ]);
  if (profilesErr) throw profilesErr;
  if (projectsErr) throw projectsErr;
  if (tagsErr) throw tagsErr;

  const { data: projectTagLinks, error: ptErr } = await supabase
    .from("project_tags")
    .select("project_id, tag_id");
  if (ptErr) throw ptErr;
  const defaultTagsByProject = new Map();
  for (const link of projectTagLinks ?? []) {
    if (!defaultTagsByProject.has(link.project_id)) defaultTagsByProject.set(link.project_id, []);
    defaultTagsByProject.get(link.project_id).push(link.tag_id);
  }

  const profileByEmail = new Map(profiles.map((p) => [(p.email ?? "").toLowerCase(), p]));
  const projectByName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p]));
  const tagByName = new Map(tags.map((t) => [t.name.trim().toLowerCase(), t]));

  const resolveUserEmail = (csvEmail) => {
    const mapped = mapping.users?.[csvEmail] ?? csvEmail;
    return mapped?.trim().toLowerCase();
  };
  const resolveProjectName = (csvName) =>
    (mapping.projects?.[csvName] ?? csvName)?.trim().toLowerCase();

  // --- Match every row, building the actual insert candidates ---
  const candidates = [];
  const unmatchedUsers = new Map(); // email -> count
  const unmatchedProjects = new Map(); // name -> count (still tracked/reported either way)
  const skippedBadDate = [];
  let importedWithoutProject = 0;

  for (const r of rows) {
    const csvEmail = (r.Email ?? "").trim();
    const csvProject = (r.Project ?? "").trim();
    const profile = profileByEmail.get(resolveUserEmail(csvEmail));
    const project = projectByName.get(resolveProjectName(csvProject));

    if (!profile) {
      unmatchedUsers.set(csvEmail, (unmatchedUsers.get(csvEmail) ?? 0) + 1);
      continue;
    }
    if (!project) {
      unmatchedProjects.set(csvProject, (unmatchedProjects.get(csvProject) ?? 0) + 1);
      // Unlike an unmatched person (user_id is NOT NULL — there's no
      // fallback), project_id is nullable, so --allow-unmatched-projects
      // can still import the row unattributed rather than lose it
      // outright. Off by default: silently landing entries with no
      // project is its own kind of surprise, so this stays opt-in.
      if (!args.allowUnmatchedProjects) continue;
    }

    const timeZone = profile.timezone || args.fallbackTimezone;
    const start = parseClockifyDateTime(r["Start Date"], r["Start Time"], timeZone);
    const end = parseClockifyDateTime(r["End Date"], r["End Time"], timeZone);
    if (!start || !end || end <= start) {
      skippedBadDate.push(r.__line);
      continue;
    }

    const tagNames = (r.Tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const resolvedTagIds = tagNames.map((t) => tagByName.get(t.toLowerCase())?.id).filter(Boolean);
    const tagIds = resolvedTagIds.length
      ? resolvedTagIds
      : project
        ? (defaultTagsByProject.get(project.id) ?? [])
        : [];

    const billableRaw = (r.Billable ?? "").trim().toLowerCase();
    // No project to read a default billable flag from — same true-by-default
    // fallback the app itself uses (project?.billable ?? true in
    // use-time-entries.ts) when an entry has no project.
    const isBillable =
      billableRaw === "yes" ? true : billableRaw === "no" ? false : (project?.is_billable ?? true);

    if (!project) importedWithoutProject += 1;

    for (const seg of splitByDayInZone(start, end, timeZone)) {
      candidates.push({
        __line: r.__line,
        user_id: profile.id,
        project_id: project?.id ?? null,
        task: (r.Task ?? "").trim(),
        description: (r.Description ?? "").trim(),
        start_time: seg.start.toISOString(),
        end_time: seg.end.toISOString(),
        entry_date: seg.date,
        duration_minutes: seg.minutes,
        is_billable: isBillable,
        tag_ids: tagIds,
        __archived_project: project?.is_archived ?? false,
      });
    }
  }

  // --- Exact-duplicate check within the file itself ---
  const seen = new Set();
  const deduped = [];
  let exactDupes = 0;
  for (const c of candidates) {
    const key = `${c.user_id}|${c.start_time}|${c.end_time}`;
    if (seen.has(key)) {
      exactDupes += 1;
      continue;
    }
    seen.add(key);
    deduped.push(c);
  }

  // --- Report ---
  console.log("\n--- Match report ---");
  console.log(`Rows matched and ready to import (after day-splitting): ${deduped.length}`);
  if (args.allowUnmatchedProjects) {
    console.log(
      `  ...of which ${importedWithoutProject} have no project (unmatched, imported with ` +
        "project_id left null — see the unmatched-projects list below).",
    );
  }
  console.log(`Exact duplicate rows within the file (dropped): ${exactDupes}`);
  console.log(
    `Rows skipped — unparseable start/end time: ${skippedBadDate.length}${skippedBadDate.length ? ` (lines: ${skippedBadDate.join(", ")})` : ""}`,
  );
  if (unmatchedUsers.size) {
    console.log(`\nUnmatched emails (${unmatchedUsers.size}) — these rows were skipped entirely:`);
    for (const [email, count] of unmatchedUsers)
      console.log(`  ${email || "(blank)"} — ${count} row(s)`);
    console.log("  Fix via --mapping, or by inviting/approving these people in IronTrack first.");
  }
  if (unmatchedProjects.size) {
    console.log(
      `\nUnmatched projects (${unmatchedProjects.size}) — these rows were ` +
        `${args.allowUnmatchedProjects ? "imported with no project attached" : "skipped entirely"}:`,
    );
    for (const [name, count] of unmatchedProjects)
      console.log(`  ${name || "(blank)"} — ${count} row(s)`);
    console.log(
      args.allowUnmatchedProjects
        ? "  Fix via --mapping, or by creating/renaming these projects in IronTrack first — " +
            "otherwise these rows land with no project, same as any other entry logged with " +
            '"No project" today.'
        : "  Fix via --mapping, or by creating/renaming these projects in IronTrack first, or " +
            "pass --allow-unmatched-projects to import these rows anyway with no project attached.",
    );
  }
  const archivedHits = deduped.filter((c) => c.__archived_project);
  if (archivedHits.length) {
    console.log(
      `\nNote: ${archivedHits.length} matched row(s) belong to a project that's now archived in ` +
        "IronTrack — importing historical time against it is fine (archiving only hides it from " +
        "new-entry pickers), just flagging so it's not a surprise.",
    );
  }

  if (!args.commit) {
    console.log(
      "\nDry run only — nothing was written. Re-run with --commit once the unmatched lists " +
        "above look right (empty, or expected).",
    );
    return;
  }

  // --- Commit: insert one row at a time so one bad row can't sink the batch ---
  console.log(`\nCommitting ${deduped.length} row(s)...`);
  let inserted = 0;
  let overlapSkipped = 0;
  let otherFailed = 0;
  for (const c of deduped) {
    const { __line, __archived_project, ...row } = c;
    const { error } = await supabase.from("time_entries").insert(row);
    if (!error) {
      inserted += 1;
      continue;
    }
    if (error.code === "23P01") {
      overlapSkipped += 1;
      console.warn(
        `  line ${__line}: skipped — overlaps an entry that already exists for this person.`,
      );
    } else {
      otherFailed += 1;
      console.error(`  line ${__line}: failed — ${error.message}`);
    }
  }

  console.log("\n--- Commit summary ---");
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (overlapping existing entry): ${overlapSkipped}`);
  console.log(`Failed (other reason, see above): ${otherFailed}`);
  console.log(
    "\nImported entries are ordinary, unsubmitted time_entries — nothing in timesheets was " +
      "touched. Decide separately whether any of these past weeks should be marked submitted.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
