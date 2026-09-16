#!/usr/bin/env node
// One-time investigation of the known duplicate-time-entries problem: the H18
// Clockify import and the M46 casual-workbook import both loaded the same work
// for the overlapping window, so Reports -> Gross Profit (M48) and Reports ->
// By employee / By project double-count it. Reports -> Casual Service is fine,
// since it filters to service_category IS NOT NULL.
//
// This script ONLY READS. It has no --commit flag and issues no writes. Its job
// is to answer the one question that decides the fix, which was deliberately
// not guessed at: do the two sets pair up cleanly enough to collapse each pair
// into a single row (carrying the category AND the real timestamps), or do they
// pair too loosely, leaving "pick an authoritative source and delete the other"
// as the only honest option?
//
// The two sets are distinguishable by construction:
//   Clockify (H18): service_category IS NULL, real start/end times, task filled
//                   from Clockify's Task column, raw unrounded hours.
//   Workbook (M46): service_category IS NOT NULL, synthetic 01:00:00 start,
//                   task = "", hours already rounded to the billing increment.
//
// DELETE THIS SCRIPT once the duplicates are resolved — same precedent as
// import-clockify-history.mjs and import-casual-service-history.mjs.
//
// Usage:
//   node scripts/analyze-duplicate-entries.mjs [options]
//
// Options:
//   --from <YYYY-MM-DD>  Start of the overlap window (default 2025-01-02).
//   --to <YYYY-MM-DD>    End of the overlap window (default 2026-09-03).
//   --samples <n>        Mismatched groups to print in full (default 10).
//
// Required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (same as src/integrations/supabase/client.server.ts). The service-role key is
// needed because these rows belong to many different users and RLS would
// otherwise hide most of them.

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const FROM = flag("--from", "2025-01-02");
const TO = flag("--to", "2026-09-03");
const SAMPLES = Number(flag("--samples", "10"));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;

async function fetchAll(table, columns, apply) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from(table)
      .select(columns)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Descriptions come from two different exports of the same source text, so
// compare them normalized rather than byte-for-byte.
const norm = (s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const hoursOf = (r) => {
  if (r.duration_minutes != null) return r.duration_minutes / 60;
  if (r.start_time && r.end_time) {
    return (new Date(r.end_time) - new Date(r.start_time)) / 3_600_000;
  }
  return 0;
};

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (n, d) => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`);

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

console.log(`Reading time_entries for ${FROM} .. ${TO} (inclusive)\n`);

const entries = await fetchAll(
  "time_entries",
  "id, user_id, project_id, entry_date, description, task, duration_minutes, start_time, end_time, service_category",
  (q) => q.gte("entry_date", FROM).lte("entry_date", TO),
);

const clockify = entries.filter((r) => r.service_category == null);
const workbook = entries.filter((r) => r.service_category != null);

const clockifyHours = sum(clockify.map(hoursOf));
const workbookHours = sum(workbook.map(hoursOf));

console.log("=== Totals in window ===");
console.log(`Clockify (category NULL):     ${clockify.length} rows, ${round2(clockifyHours)} hrs`);
console.log(`Workbook (category NOT NULL): ${workbook.length} rows, ${round2(workbookHours)} hrs`);
console.log(
  `Combined (what the money reports currently count): ${round2(clockifyHours + workbookHours)} hrs\n`,
);

// The pairing key. project_id is the client proxy: the workbook import resolved
// each client to one of that client's projects, same as the Clockify import.
const keyOf = (r) => `${r.user_id}|${r.project_id ?? "-"}|${r.entry_date}|${norm(r.description)}`;

const cGroups = groupBy(clockify, keyOf);
const wGroups = groupBy(workbook, keyOf);

const bothKeys = [];
const clockifyOnlyKeys = [];
const workbookOnlyKeys = [];

for (const k of cGroups.keys()) (wGroups.has(k) ? bothKeys : clockifyOnlyKeys).push(k);
for (const k of wGroups.keys()) if (!cGroups.has(k)) workbookOnlyKeys.push(k);

const rowsIn = (keys, groups) => sum(keys.map((k) => groups.get(k).length));
const hoursIn = (keys, groups) => sum(keys.map((k) => sum(groups.get(k).map(hoursOf))));

console.log("=== Pairing on (user, project, date, description) ===");
console.log(
  `Keys in BOTH sets:      ${bothKeys.length}  ` +
    `(${rowsIn(bothKeys, cGroups)} Clockify rows / ${rowsIn(bothKeys, wGroups)} workbook rows)`,
);
console.log(
  `Keys only in Clockify:  ${clockifyOnlyKeys.length}  ` +
    `(${rowsIn(clockifyOnlyKeys, cGroups)} rows, ${round2(hoursIn(clockifyOnlyKeys, cGroups))} hrs)`,
);
console.log(
  `Keys only in workbook:  ${workbookOnlyKeys.length}  ` +
    `(${rowsIn(workbookOnlyKeys, wGroups)} rows, ${round2(hoursIn(workbookOnlyKeys, wGroups))} hrs)`,
);
console.log(
  `Workbook rows covered by a Clockify twin: ` +
    `${pct(rowsIn(bothKeys, wGroups), workbook.length)} of all workbook rows in window\n`,
);

// Within a shared key, do the two sides have the same number of rows? Equal
// counts mean each workbook row has exactly one Clockify row to collapse into.
const sameCount = [];
const diffCount = [];
for (const k of bothKeys) {
  (cGroups.get(k).length === wGroups.get(k).length ? sameCount : diffCount).push(k);
}

console.log("=== Cardinality within shared keys ===");
console.log(
  `Equal row counts (collapsible 1:1): ${sameCount.length} keys, ` +
    `${rowsIn(sameCount, wGroups)} workbook rows, ${round2(hoursIn(sameCount, wGroups))} hrs`,
);
console.log(
  `Unequal row counts (needs a call):  ${diffCount.length} keys, ` +
    `${rowsIn(diffCount, wGroups)} workbook rows, ${round2(hoursIn(diffCount, wGroups))} hrs\n`,
);

// On equal-count keys, pair rows by ascending hours and check the workbook row
// is the rounded-up twin of the Clockify row. A negative delta, or one larger
// than a plausible increment, means these are not the same work after all.
let pairs = 0;
let roundedUp = 0;
let exactSame = 0;
let negative = 0;
let bigDelta = 0;
let deltaHours = 0;
const deltaBuckets = new Map();
const oddPairs = [];

for (const k of sameCount) {
  const cs = [...cGroups.get(k)].map(hoursOf).sort((a, b) => a - b);
  const ws = [...wGroups.get(k)].map(hoursOf).sort((a, b) => a - b);
  for (let i = 0; i < cs.length; i++) {
    const d = round2(ws[i] - cs[i]);
    pairs++;
    deltaHours += ws[i] - cs[i];
    if (d === 0) exactSame++;
    else if (d < 0) {
      negative++;
      if (oddPairs.length < SAMPLES)
        oddPairs.push({ key: k, clockify: round2(cs[i]), workbook: round2(ws[i]), delta: d });
    } else {
      roundedUp++;
      if (d > 0.5) {
        bigDelta++;
        if (oddPairs.length < SAMPLES)
          oddPairs.push({ key: k, clockify: round2(cs[i]), workbook: round2(ws[i]), delta: d });
      }
    }
    const b = d.toFixed(2);
    deltaBuckets.set(b, (deltaBuckets.get(b) ?? 0) + 1);
  }
}

console.log("=== Hours relationship on 1:1 pairs (workbook minus Clockify) ===");
console.log(`Pairs compared:              ${pairs}`);
console.log(`Workbook rounded UP:         ${roundedUp} (${pct(roundedUp, pairs)})`);
console.log(`Identical hours:             ${exactSame} (${pct(exactSame, pairs)})`);
console.log(`Workbook LOWER (suspicious): ${negative} (${pct(negative, pairs)})`);
console.log(`Delta > 0.5 hr (suspicious): ${bigDelta} (${pct(bigDelta, pairs)})`);
console.log(`Total rounding uplift:       ${round2(deltaHours)} hrs\n`);

const topDeltas = [...deltaBuckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log("Most common deltas (hrs -> pair count):");
for (const [d, n] of topDeltas) console.log(`  ${d.padStart(7)} -> ${n}`);
console.log();

if (oddPairs.length) {
  console.log(`=== Sample pairs that do NOT look like raw-vs-rounded (max ${SAMPLES}) ===`);
  for (const p of oddPairs) {
    console.log(`  ${p.key}`);
    console.log(`    clockify ${p.clockify} hrs, workbook ${p.workbook} hrs, delta ${p.delta}`);
  }
  console.log();
}

if (diffCount.length) {
  console.log(`=== Sample shared keys with unequal row counts (max ${SAMPLES}) ===`);
  for (const k of diffCount.slice(0, SAMPLES)) {
    console.log(`  ${k}`);
    console.log(
      `    clockify ${cGroups.get(k).length} rows / ${round2(sum(cGroups.get(k).map(hoursOf)))} hrs, ` +
        `workbook ${wGroups.get(k).length} rows / ${round2(sum(wGroups.get(k).map(hoursOf)))} hrs`,
    );
  }
  console.log();
}

// A description mismatch would show up as a key present on only one side that
// still has a same-user/same-project/same-date counterpart. Re-key the leftovers
// without the description to see how much of the non-overlap is just text drift.
const looseKey = (r) => `${r.user_id}|${r.project_id ?? "-"}|${r.entry_date}`;
const cLeft = clockifyOnlyKeys.flatMap((k) => cGroups.get(k));
const wLeft = workbookOnlyKeys.flatMap((k) => wGroups.get(k));
const cLoose = groupBy(cLeft, looseKey);
const wLoose = groupBy(wLeft, looseKey);
const looseBoth = [...wLoose.keys()].filter((k) => cLoose.has(k));
const looseWorkbookRows = sum(looseBoth.map((k) => wLoose.get(k).length));

console.log("=== Leftovers re-keyed without description ===");
console.log(
  `Unmatched workbook rows: ${wLeft.length}; of those, ${looseWorkbookRows} ` +
    `(${pct(looseWorkbookRows, wLeft.length || 1)}) share user+project+date with an unmatched Clockify row.`,
);
console.log(
  `Meaning: description text drift, not genuinely unpaired work, for that portion. ` +
    `The remaining ${wLeft.length - looseWorkbookRows} workbook rows have no Clockify counterpart at all.\n`,
);

const collapsible = rowsIn(sameCount, wGroups);
console.log("=== Verdict ===");
console.log(
  `${collapsible} of ${workbook.length} workbook rows (${pct(collapsible, workbook.length)}) ` +
    `sit in a shared key with matching cardinality, so they can be collapsed 1:1 without judgement.`,
);
console.log(
  `The other ${workbook.length - collapsible} need a decision. If that number is small and the ` +
    `deltas above are all small positive roundings, option 2 (collapse each pair into one row) is viable. ` +
    `If negatives or large deltas are common, the two sets are not the same work and nothing should be deleted.`,
);
