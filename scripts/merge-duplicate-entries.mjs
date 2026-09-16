#!/usr/bin/env node
// One-time fix for the duplicate-time-entries problem that analyze-duplicate-entries.mjs
// quantified: the H18 Clockify import and the M46 casual-workbook import both loaded the
// same work for 2025-01-02..2026-09-03, so Gross Profit (M48) and Reports -> By employee /
// By project count it twice.
//
// This script handles ONLY the unambiguous 91.4%: workbook rows that pair 1:1 with a
// Clockify row on (user, project, date, description) where both sides have the same number
// of rows. For each pair it moves the workbook row's three M46-only fields onto the
// Clockify row and then deletes the workbook row:
//
//   service_category, va_paid_at, is_billable  ->  the Clockify row
//
// The Clockify row is kept as the survivor because it has the real start/end times and the
// Clockify task name; the workbook row has a synthetic 9am-local start and an empty task.
// Measured across all 15,600 pairs, 98% have identical hours, so this is not a
// reconciliation — it is deduplication.
//
// Deliberately NOT touched, because each needs a human call (see the analysis output):
//   - 174 rows in keys where the two sides have unequal row counts.
//   - 1,299 rows with no exact-key twin (401 look like description drift, 898 have no
//     Clockify counterpart at all and are plausibly legitimate work H18 skipped).
//   - any pair whose hours differ by more than MAX_DELTA_HOURS.
//
// One consequence worth knowing: for the ~1.5% of pairs where the workbook figure was
// rounded up, the surviving row carries the RAW hours (57 hrs lower in total across the
// whole window). That is the more correct basis, since M46's increment rounding is applied
// at report time from the billing-increment setting rather than baked into the row.
//
// DELETE THIS SCRIPT once the cleanup is done and verified — same precedent as
// import-clockify-history.mjs and import-casual-service-history.mjs.
//
// Usage:
//   node scripts/merge-duplicate-entries.mjs              # dry run, writes nothing
//   node scripts/merge-duplicate-entries.mjs --commit     # writes, after saving a backup
//
// Options:
//   --from <YYYY-MM-DD>  Start of the overlap window (default 2025-01-02).
//   --to <YYYY-MM-DD>    End of the overlap window (default 2026-09-03).
//   --commit             Actually write. Omit for a dry run.
//   --backup <path>      Where to save the pre-change snapshot
//                        (default ./duplicate-merge-backup-<timestamp>.json).
//
// The backup holds every row this script deletes, in full, plus the prior value of every
// field it overwrites — enough to reconstruct the exact prior state by hand if needed.
//
// Required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const FROM = flag("--from", "2025-01-02");
const TO = flag("--to", "2026-09-03");
const COMMIT = args.includes("--commit");
const BACKUP = flag("--backup", `./duplicate-merge-backup-${Date.now()}.json`);

// A pair whose hours disagree by more than this is not obviously the same work, so it is
// left alone rather than guessed at.
const MAX_DELTA_HOURS = 0.5;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;

async function fetchAll() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .gte("entry_date", FROM)
      .lte("entry_date", TO)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`read time_entries: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const norm = (s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const round2 = (n) => Math.round(n * 100) / 100;

const hoursOf = (r) => {
  if (r.duration_minutes != null) return r.duration_minutes / 60;
  if (r.start_time && r.end_time)
    return (new Date(r.end_time) - new Date(r.start_time)) / 3_600_000;
  return 0;
};

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// Run `worker` over `items` with bounded concurrency — 15.6k single-row updates issued
// serially would take far too long, and unbounded would hammer the connection pool.
async function pooled(items, limit, worker) {
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
      if (++done % 500 === 0) console.log(`  ${done}/${items.length}`);
    }
  });
  await Promise.all(runners);
}

console.log(`Reading time_entries for ${FROM} .. ${TO}\n`);
const entries = await fetchAll();

const clockify = entries.filter((r) => r.service_category == null);
const workbook = entries.filter((r) => r.service_category != null);

const keyOf = (r) => `${r.user_id}|${r.project_id ?? "-"}|${r.entry_date}|${norm(r.description)}`;
const cGroups = groupBy(clockify, keyOf);
const wGroups = groupBy(workbook, keyOf);

const plan = [];
let skippedDelta = 0;
let skippedCardinality = 0;
let skippedNoTwin = 0;

for (const [k, ws] of wGroups) {
  const cs = cGroups.get(k);
  if (!cs) {
    skippedNoTwin += ws.length;
    continue;
  }
  if (cs.length !== ws.length) {
    skippedCardinality += ws.length;
    continue;
  }
  // Pair by ascending hours so the closest figures line up within a key.
  const csSorted = [...cs].sort((a, b) => hoursOf(a) - hoursOf(b));
  const wsSorted = [...ws].sort((a, b) => hoursOf(a) - hoursOf(b));
  for (let i = 0; i < csSorted.length; i++) {
    const survivor = csSorted[i];
    const victim = wsSorted[i];
    const delta = hoursOf(victim) - hoursOf(survivor);
    if (Math.abs(delta) > MAX_DELTA_HOURS) {
      skippedDelta++;
      continue;
    }
    plan.push({ survivor, victim, delta: round2(delta) });
  }
}

const deltaHours = plan.reduce((a, p) => a + p.delta, 0);

console.log("=== Plan ===");
console.log(`Workbook rows in window:                 ${workbook.length}`);
console.log(`Pairs to merge (update + delete):        ${plan.length}`);
console.log(
  `Hours removed from the double-count:     ${round2(plan.reduce((a, p) => a + hoursOf(p.victim), 0))}`,
);
console.log(
  `Net hours change on surviving rows:      ${round2(-deltaHours)} (raw kept over rounded)`,
);
console.log("");
console.log("Left untouched, needing a human call:");
console.log(`  no exact-key twin:                     ${skippedNoTwin} rows`);
console.log(`  unequal row counts within a key:       ${skippedCardinality} rows`);
console.log(`  hours differ by more than ${MAX_DELTA_HOURS} hr:      ${skippedDelta} rows`);
console.log("");

const carriesPaidDate = plan.filter((p) => p.victim.va_paid_at != null).length;
const changesBillable = plan.filter((p) => p.victim.is_billable !== p.survivor.is_billable).length;
console.log(
  `Of the merges: ${carriesPaidDate} carry a va_paid_at date forward, ` +
    `${changesBillable} change the survivor's is_billable flag.`,
);
console.log("");

const sample = plan.slice(0, 3);
console.log("Sample merges:");
for (const p of sample) {
  console.log(
    `  keep  ${p.survivor.id}  ${p.survivor.entry_date}  ${round2(hoursOf(p.survivor))} hrs  "${(p.survivor.description ?? "").slice(0, 50)}"`,
  );
  console.log(
    `    <- gains category=${p.victim.service_category} va_paid_at=${p.victim.va_paid_at} is_billable=${p.victim.is_billable}`,
  );
  console.log(`  drop  ${p.victim.id}  ${round2(hoursOf(p.victim))} hrs`);
}
console.log("");

if (!COMMIT) {
  console.log("DRY RUN — nothing was written. Re-run with --commit to apply.");
  process.exit(0);
}

const backup = {
  generated_at: new Date().toISOString(),
  window: { from: FROM, to: TO },
  merges: plan.map((p) => ({
    deleted_row: p.victim,
    updated_row_id: p.survivor.id,
    updated_row_prior: {
      service_category: p.survivor.service_category,
      va_paid_at: p.survivor.va_paid_at,
      is_billable: p.survivor.is_billable,
    },
  })),
};
writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
console.log(`Backup of ${plan.length} merges written to ${BACKUP}`);
console.log("Keep this file until the result has been verified in the app.\n");

console.log("Updating surviving rows...");
const updateFailures = [];
await pooled(plan, 25, async (p) => {
  const { error } = await supabase
    .from("time_entries")
    .update({
      service_category: p.victim.service_category,
      va_paid_at: p.victim.va_paid_at,
      is_billable: p.victim.is_billable,
    })
    .eq("id", p.survivor.id);
  if (error) updateFailures.push({ id: p.survivor.id, message: error.message });
});

if (updateFailures.length) {
  console.error(`\n${updateFailures.length} updates FAILED. Not deleting anything.`);
  console.error(updateFailures.slice(0, 5));
  console.error(
    "The database is unchanged apart from the updates that did succeed; the backup file records the prior values.",
  );
  process.exit(1);
}
console.log(`Updated ${plan.length} rows.\n`);

// Only delete once every survivor has safely taken on the category, so a failure
// halfway through can never lose the M46 data.
console.log("Deleting duplicate workbook rows...");
const victimIds = plan.map((p) => p.victim.id);
let deleted = 0;
for (let i = 0; i < victimIds.length; i += 500) {
  const chunk = victimIds.slice(i, i + 500);
  const { error, count } = await supabase
    .from("time_entries")
    .delete({ count: "exact" })
    .in("id", chunk);
  if (error) throw new Error(`delete failed at offset ${i}: ${error.message}`);
  deleted += count ?? chunk.length;
  console.log(`  ${deleted}/${victimIds.length}`);
}

console.log(`\nDone. Merged ${plan.length} duplicate pairs; deleted ${deleted} rows.`);
console.log(
  "Verify: re-run scripts/analyze-duplicate-entries.mjs — the 1:1 collapsible count should now be 0.",
);
console.log(
  "Then check Reports -> Gross Profit and Reports -> Casual Service against the same week in the workbook.",
);
