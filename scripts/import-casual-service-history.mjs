#!/usr/bin/env node
// M46: one-time historical import for Casual Service Monitoring — mirrors
// the shape of the now-deleted scripts/import-clockify-history.mjs (H18,
// see docs/audit-findings.md): dependency-free beyond @supabase/supabase-js
// (already a project dependency), defaults to a dry run, requires --commit
// to actually write, uses the service-role key (bypasses RLS — a bulk
// historical backfill isn't a live user action, same reasoning H18 used),
// and never guesses at an unmatched name — unmatched rows are reported and
// skipped unless resolved via --mapping.
//
// DELETE THIS SCRIPT (and any --mapping file used with it) once the
// one-time cutover import is done and verified — same as the Clockify
// script's own header comment instructed, and for the same reason: it has
// no ongoing purpose once the historical data has moved.
//
// Usage:
//   node scripts/import-casual-service-history.mjs <path-to-csv> [options]
//
// Options:
//   --commit                  Actually write to the database. Omit for a dry run.
//   --mapping <path.json>     JSON file resolving names the dry run reports as unmatched (see below).
//   --date-format <dmy|mdy>   How to read a non-ISO, non-numeric date cell. Default: dmy
//                             (Ironbrij is an Australian company — Excel on an AU-locale
//                             machine formats dates DD/MM/YYYY). Get this wrong and every
//                             date before the 13th of a month silently transposes day/month,
//                             so confirm against a few known rows in the dry run output before
//                             ever passing --commit.
//
// Required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (same as src/integrations/supabase/client.server.ts).
//
// --mapping file shape (all keys optional):
// {
//   "vaNames": { "Vellih": "Vellih Santos" },           // spreadsheet "VA Name" -> profiles.full_name (exact)
//   "clientNames": { "Alium Wrks": "Alium Works" },     // spreadsheet "Client Name" -> clients.name (exact)
//   "clientProjects": { "Alium Works": "<project-uuid>" } // which project to attach entries to, when a client has 0 or 2+ projects
// }
//
// What this script deliberately does NOT do, and why:
//   - Import "Actual hours from Clockify" (only ~419 of 22,276 rows have it,
//     a manual reconciliation check against Clockify that's moot now that
//     IronTrack's own Clockify cutover (H18) already covers this period —
//     importing it risks double-counting hours already inserted then.
//   - Import "Hours After Adding Increment" as anything other than raw
//     duration. Per the product decision behind M46, the billing-increment
//     rounding rule (src/lib/casual-billing.ts) is computed at report time,
//     never stored — but the spreadsheet itself only ever recorded the
//     already-rounded figure (there is no true "raw" hours column), so
//     historical rows necessarily store that already-rounded number as
//     duration_minutes. Confirmed acceptable with the product owner; new
//     entries going forward store genuinely raw tracked time.
//   - Guess at an unresolved VA or client name, or auto-create a client/
//     project for one. Every unmatched name is reported and skipped.
//   - Set duration_minutes directly — a BEFORE trigger
//     (compute_time_entry_duration, 20260814010000) recomputes it from
//     start_time/end_time on every write regardless of what's sent, so
//     this script constructs start_time/end_time instead and lets the
//     trigger derive the minutes, the same as every other write path in
//     this app already does.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
const mappingPath = args.includes("--mapping") ? args[args.indexOf("--mapping") + 1] : null;
const dateFormatArgIdx = args.indexOf("--date-format");
const dateFormat = dateFormatArgIdx >= 0 ? args[dateFormatArgIdx + 1] : "dmy";

if (!csvPath) {
  console.error(
    "Usage: node scripts/import-casual-service-history.mjs <path-to-csv> [--commit] [--mapping <path.json>] [--date-format dmy|mdy]",
  );
  process.exit(1);
}
if (dateFormat !== "dmy" && dateFormat !== "mdy") {
  console.error(`--date-format must be "dmy" or "mdy", got "${dateFormat}"`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const mapping = mappingPath
  ? JSON.parse(readFileSync(mappingPath, "utf8"))
  : { vaNames: {}, clientNames: {}, clientProjects: {} };

// ---------------------------------------------------------------------------
// CSV parsing — hand-rolled RFC4180-ish parser (quoted fields, embedded
// commas/quotes/newlines) rather than a dependency, same reasoning the
// Clockify import avoided one.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Date parsing — handles the three shapes a "Save As CSV" of this workbook
// could plausibly produce: a raw Excel serial number (if the cell's number
// format didn't survive the export), an ISO string, or a locale-formatted
// date string (day/month order per --date-format, since that's genuinely
// ambiguous from the string alone).
// ---------------------------------------------------------------------------
function excelSerialToDateKey(serial) {
  const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDateCell(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    return excelSerialToDateKey(Number(value));
  }
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    let [, a, b, y] = slashMatch;
    if (y.length === 2) y = `20${y}`;
    const [day, month] = dateFormat === "dmy" ? [a, b] : [b, a];
    const d = String(day).padStart(2, "0");
    const m = String(month).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Timezone-aware local-wall-clock -> UTC instant conversion (DST-safe),
// since the source data has a date and an hours total but no real
// start/end times. Synthesizes a start of 09:00 local time (matched
// person's own profiles.timezone) for every row — an arbitrary but
// harmless anchor, since nothing downstream reads start_time as a real
// clock-in for this historical category.
// ---------------------------------------------------------------------------
function zonedTimeToUtc(dateKey, hour, minute, timeZone) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcGuess)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = asUtc - utcGuess;
  return new Date(utcGuess - offset);
}

const SERVICE_CATEGORY_MAP = {
  ironbrij: "ironbrij",
  "paid casual service": "paid_casual",
  "vip client": "vip_client",
  promotional: "promotional",
};

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const csvText = readFileSync(csvPath, "utf8");
  const [header, ...dataRows] = parseCsv(csvText);
  const col = (name) => {
    const idx = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    if (idx === -1) throw new Error(`CSV is missing expected column "${name}"`);
    return idx;
  };
  const idx = {
    date: col("Date of Service"),
    client: col("Client Name"),
    category: col("Service Status"),
    vaPaid: col("VA Paid Date"),
    hours: col("Hours After Adding Increment"),
    task: col("Task Description"),
    va: col("VA Name"),
  };

  console.log(`Read ${dataRows.length} data rows from ${csvPath}. Date format: ${dateFormat}.`);

  const [{ data: profiles, error: profilesError }, { data: clients, error: clientsError }] =
    await Promise.all([
      supabase.from("profiles").select("id, full_name, timezone"),
      supabase.from("clients").select("id, name"),
    ]);
  if (profilesError) throw profilesError;
  if (clientsError) throw clientsError;

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, client_id, archived");
  if (projectsError) throw projectsError;

  const profileByName = new Map(profiles.map((p) => [p.full_name.trim().toLowerCase(), p]));
  const clientByName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c]));
  const projectsByClient = new Map();
  for (const p of projects) {
    if (!p.client_id) continue;
    const list = projectsByClient.get(p.client_id) ?? [];
    list.push(p);
    projectsByClient.set(p.client_id, list);
  }

  function resolveVa(rawName) {
    const name = rawName.trim();
    if (!name) return { error: "blank VA name" };
    const mapped = mapping.vaNames[name];
    const lookupName = (mapped ?? name).trim().toLowerCase();
    const exact = profileByName.get(lookupName);
    if (exact) return { profile: exact };
    // Reported as a suggestion only — never auto-applied, per the "never
    // guess" rule this script (and H18 before it) is built around.
    const firstTokenMatches = profiles.filter(
      (p) => p.full_name.trim().toLowerCase().split(/\s+/)[0] === name.toLowerCase(),
    );
    return {
      error: `no profiles.full_name match for VA "${name}"`,
      suggestion:
        firstTokenMatches.length === 1
          ? `possible match: "${firstTokenMatches[0].full_name}" — add to --mapping vaNames if correct`
          : firstTokenMatches.length > 1
            ? `${firstTokenMatches.length} possible first-name matches — needs --mapping vaNames`
            : undefined,
    };
  }

  function resolveClientAndProject(rawName) {
    const name = rawName.trim();
    if (!name) return { error: "blank client name" };
    const mapped = mapping.clientNames[name];
    const lookupName = (mapped ?? name).trim().toLowerCase();
    const client = clientByName.get(lookupName);
    if (!client) return { error: `no clients.name match for "${name}"` };
    const mappedProjectId = mapping.clientProjects[client.name];
    if (mappedProjectId) return { client, projectId: mappedProjectId };
    const candidates = (projectsByClient.get(client.id) ?? []).filter((p) => !p.archived);
    if (candidates.length === 1) return { client, projectId: candidates[0].id };
    return {
      error:
        candidates.length === 0
          ? `client "${client.name}" matched but has no active project — add clientProjects["${client.name}"] to --mapping`
          : `client "${client.name}" has ${candidates.length} active projects — add clientProjects["${client.name}"] to --mapping to disambiguate`,
    };
  }

  const toInsert = [];
  const unmatched = new Map(); // reason -> count, for a compact summary
  let skippedBadCategory = 0;
  let skippedBadDate = 0;

  for (const [i, row] of dataRows.entries()) {
    const rowNum = i + 2; // +1 for header, +1 for 1-indexing
    const dateKey = parseDateCell(row[idx.date] ?? "");
    if (!dateKey) {
      skippedBadDate++;
      continue;
    }
    const categoryRaw = (row[idx.category] ?? "").trim().toLowerCase();
    const category = SERVICE_CATEGORY_MAP[categoryRaw];
    if (!category) {
      skippedBadCategory++;
      continue;
    }
    const va = resolveVa(row[idx.va] ?? "");
    if (va.error) {
      const key = va.suggestion ? `${va.error} (${va.suggestion})` : va.error;
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
      continue;
    }
    const cp = resolveClientAndProject(row[idx.client] ?? "");
    if (cp.error) {
      unmatched.set(cp.error, (unmatched.get(cp.error) ?? 0) + 1);
      continue;
    }
    const hours = Number(row[idx.hours]);
    if (!Number.isFinite(hours) || hours <= 0) {
      unmatched.set(`invalid hours value on row ${rowNum}: "${row[idx.hours]}"`, 1);
      continue;
    }
    const vaPaidAt = parseDateCell(row[idx.vaPaid] ?? "");
    const start = zonedTimeToUtc(dateKey, 9, 0, va.profile.timezone || "Australia/Sydney");
    const durationMinutes = Math.max(1, Math.round(hours * 60));
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    toInsert.push({
      user_id: va.profile.id,
      project_id: cp.projectId,
      task: "",
      description: (row[idx.task] ?? "").trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entry_date: dateKey,
      is_billable: category !== "ironbrij",
      service_category: category,
      va_paid_at: vaPaidAt,
      tag_ids: [],
    });
  }

  console.log(`\nMatched ${toInsert.length} of ${dataRows.length} rows.`);
  console.log(`Skipped ${skippedBadDate} rows with an unparseable date.`);
  console.log(`Skipped ${skippedBadCategory} rows with an unrecognized Service Status value.`);
  if (unmatched.size > 0) {
    console.log(
      `\nUnmatched (${[...unmatched.values()].reduce((a, b) => a + b, 0)} rows) — resolve via --mapping, never guessed:`,
    );
    for (const [reason, count] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x  ${reason}`);
    }
  }

  if (toInsert.length > 0) {
    const sample = toInsert[0];
    console.log(`\nSample row to insert: ${JSON.stringify(sample, null, 2)}`);
  }

  if (!commit) {
    console.log(`\nDry run only — no rows written. Re-run with --commit once this looks right.`);
    return;
  }

  console.log(`\nWriting ${toInsert.length} rows in batches of 500...`);
  let written = 0;
  let failed = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500);
    const { error, count } = await supabase.from("time_entries").insert(batch, { count: "exact" });
    if (error) {
      // A batch failure (e.g. a constraint violation) is reported, not
      // silently retried row-by-row — same "fail loudly" preference as
      // the rest of this app's defense-in-depth constraints are meant to
      // surface, not paper over.
      console.error(`Batch starting at row ${i} failed: ${error.message}`);
      failed += batch.length;
      continue;
    }
    written += count ?? batch.length;
    console.log(`  ...${written}/${toInsert.length}`);
  }
  console.log(`\nDone. Wrote ${written} rows, ${failed} failed.`);
  console.log(
    `Verify directly: SELECT count(*) FROM time_entries WHERE service_category IS NOT NULL; — should be at least ${written} (plus any entries already logged live through the app).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
