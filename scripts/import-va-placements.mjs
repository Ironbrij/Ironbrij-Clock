#!/usr/bin/env node
// M49: one-time import of the accounts workbook's "VA Package" sheet into
// placed_vas / va_placements. Follows the shape of the now-deleted
// scripts/import-casual-service-history.mjs (M46) and
// import-clockify-history.mjs (H18), see docs/audit-findings.md:
// dependency-free beyond @supabase/supabase-js (already a project
// dependency), defaults to a dry run, requires --commit to write, uses the
// service-role key (a bulk backfill isn't a live user action), and never
// guesses at an unmatched name.
//
// DELETE THIS SCRIPT (and any --mapping file used with it) once the
// one-time import is done and verified — same as its two predecessors,
// and for the same reason: it has no ongoing purpose afterwards.
//
// Usage:
//   node scripts/import-va-placements.mjs <path-to-csv> [options]
//
// Options:
//   --commit                  Actually write to the database. Omit for a dry run.
//   --mapping <path.json>     JSON file resolving names the dry run reports as unmatched.
//   --create-missing-clients  Create a clients row for each unmatched client name.
//                             Deliberately opt-in and separate from --commit: several
//                             sheet names are the LEGAL name of a client already in
//                             IronTrack under a trading name, and creating both would
//                             split one client in two. Resolve those via --mapping
//                             first, then use this for whatever genuinely remains.
//
// Required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (same as src/integrations/supabase/client.server.ts).
//
// --mapping file shape (all keys optional):
// {
//   "clientNames": {
//     "TNT Creative Trust trading as Tracey Clarke Coaching": "Tracey Clarke"
//   }
// }
//
// What this script deliberately does NOT do, and why:
//   - Import the workbook's inactive/win-back sheet. Confirmed out of scope:
//     it would create ~80 client records for long-dead clients, nearly
//     doubling the client list and cluttering every client picker in the app.
//     Only Status=Active rows are read here.
//   - Import the "Management Fee" column. That figure is DERIVED at read
//     time (package - rate, or 0) so it can't drift from its inputs — see
//     src/lib/retainer.ts. The column IS still read, purely to cross-check
//     against the derived value and report any row where the sheet
//     disagrees with its own arithmetic.
//   - Import "Date Amended" — empty on every row of the export.
//   - Auto-create a client for an unmatched name unless explicitly asked
//     via --create-missing-clients.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
const createMissingClients = args.includes("--create-missing-clients");
const mappingPath = args.includes("--mapping") ? args[args.indexOf("--mapping") + 1] : null;

if (!csvPath) {
  console.error(
    "Usage: node scripts/import-va-placements.mjs <path-to-csv> [--commit] [--mapping <path.json>] [--create-missing-clients]",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const mapping = mappingPath ? JSON.parse(readFileSync(mappingPath, "utf8")) : { clientNames: {} };
const clientNameMap = mapping.clientNames ?? {};

// ---------------------------------------------------------------------------
// CSV parsing — hand-rolled RFC4180-ish parser (quoted fields, embedded
// commas/quotes/newlines) rather than a dependency, same as its predecessors.
// Matters here: amounts are quoted when they carry a thousands separator
// ("$1,650.00"), so a naive split on comma would corrupt every large number.
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
// Date parsing. This sheet's export format is unambiguous "D-Mon-YY"
// (1-Sep-22, 29-Jun-26) — a named month, so unlike M46's import there's no
// day/month transposition risk and no --date-format flag is needed.
// ---------------------------------------------------------------------------
const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseDateCell(raw) {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = value.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/** "$1,650.00" -> 1650, "N/A" / "" -> null. */
function parseAmountCell(raw) {
  const value = (raw ?? "").trim();
  if (!value || value.toUpperCase() === "N/A") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const norm = (s) => (s ?? "").trim().toLowerCase();

// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const header = rows[0].map((h) => h.trim());
const col = (name) => header.indexOf(name);

const idx = {
  employee: col("Employee"),
  status: col("Status"),
  client: col("Client"),
  started: col("Date Started"),
  rate: col("VA Monthly Rate"),
  pkg: col("VA Package with Admin Fee"),
  fee: col("Management Fee"),
};
for (const [key, value] of Object.entries(idx)) {
  if (value < 0) {
    console.error(`CSV is missing an expected column for "${key}". Header: ${header.join(" | ")}`);
    process.exit(1);
  }
}

const [{ data: clients, error: clientsError }, { data: existingVAs, error: vasError }] =
  await Promise.all([
    supabase.from("clients").select("id, name"),
    supabase.from("placed_vas").select("id, full_name"),
  ]);
if (clientsError || vasError) {
  console.error("Couldn't read existing data:", (clientsError ?? vasError).message);
  process.exit(1);
}

const clientByName = new Map(clients.map((c) => [norm(c.name), c]));
const vaByName = new Map(existingVAs.map((v) => [norm(v.full_name), v]));

const planned = [];
const skipped = [];
const unmatchedClients = new Set();
const feeMismatches = [];

for (const raw of rows.slice(1)) {
  const employee = (raw[idx.employee] ?? "").trim();
  const status = (raw[idx.status] ?? "").trim();
  const clientRaw = (raw[idx.client] ?? "").trim();
  if (!employee || !clientRaw) continue;

  // Active rows only — the inactive history is deliberately out of scope.
  if (norm(status) !== "active") {
    skipped.push({ employee, client: clientRaw, reason: `status is "${status}"` });
    continue;
  }

  const startedOn = parseDateCell(raw[idx.started]);
  if (!startedOn) {
    skipped.push({
      employee,
      client: clientRaw,
      reason: `unparseable start date "${raw[idx.started]}"`,
    });
    continue;
  }

  const mappedName = clientNameMap[clientRaw] ?? clientRaw;
  const client = clientByName.get(norm(mappedName));
  if (!client) {
    unmatchedClients.add(clientRaw);
    skipped.push({ employee, client: clientRaw, reason: "client not found in IronTrack" });
    continue;
  }

  const vaMonthlyRate = parseAmountCell(raw[idx.rate]);
  const clientPackageAmount = parseAmountCell(raw[idx.pkg]);

  // Cross-check the sheet's own arithmetic. We don't import this column —
  // the fee is derived — but a row where the sheet disagrees with itself is
  // worth a human look before it becomes a number someone reports on.
  const sheetFee = parseAmountCell(raw[idx.fee]);
  const derivedFee =
    vaMonthlyRate === null || clientPackageAmount === null
      ? 0
      : clientPackageAmount - vaMonthlyRate;
  if (sheetFee !== null && Math.abs(sheetFee - derivedFee) > 0.01) {
    feeMismatches.push({
      employee,
      client: clientRaw,
      sheet: sheetFee.toFixed(2),
      derived: derivedFee.toFixed(2),
    });
  }

  planned.push({
    employee,
    clientId: client.id,
    clientName: client.name,
    startedOn,
    vaMonthlyRate,
    clientPackageAmount,
  });
}

console.log(`\nParsed ${rows.length - 1} data rows from ${csvPath}`);
console.log(`  ${planned.length} placements ready to import`);
console.log(`  ${skipped.length} skipped`);

const newVANames = [...new Set(planned.map((p) => p.employee))].filter(
  (n) => !vaByName.has(norm(n)),
);
console.log(`  ${newVANames.length} new placed VAs would be created`);

if (unmatchedClients.size > 0) {
  console.log(`\nUnmatched client names (${unmatchedClients.size}):`);
  for (const name of [...unmatchedClients].sort()) console.log(`  - ${name}`);
  console.log(
    createMissingClients
      ? "  -> --create-missing-clients is set: these WILL be created as new clients."
      : "  -> Resolve any that are an existing client under another name via --mapping,\n" +
          "     then re-run with --create-missing-clients for the genuinely new ones.",
  );
}

if (feeMismatches.length > 0) {
  console.log(`\nRows where the sheet's Management Fee disagrees with package - rate:`);
  for (const m of feeMismatches) {
    console.log(`  - ${m.employee} / ${m.client}: sheet ${m.sheet}, derived ${m.derived}`);
  }
}

if (skipped.length > 0) {
  console.log(`\nSkipped rows:`);
  for (const s of skipped) console.log(`  - ${s.employee} / ${s.client}: ${s.reason}`);
}

if (!commit) {
  console.log("\nDry run — nothing was written. Re-run with --commit to apply.\n");
  process.exit(0);
}

// --- writes below this line ------------------------------------------------

if (createMissingClients && unmatchedClients.size > 0) {
  const toCreate = [...unmatchedClients].map((name) => ({ name }));
  const { data, error } = await supabase.from("clients").insert(toCreate).select("id, name");
  if (error) {
    console.error("Couldn't create clients:", error.message);
    process.exit(1);
  }
  for (const c of data) clientByName.set(norm(c.name), c);
  console.log(`Created ${data.length} clients.`);
  console.log("Re-run the script (without --create-missing-clients) to import their placements.");
}

for (const name of newVANames) {
  const { data, error } = await supabase
    .from("placed_vas")
    .insert({ full_name: name })
    .select("id, full_name")
    .single();
  if (error) {
    console.error(`Couldn't create placed VA "${name}":`, error.message);
    process.exit(1);
  }
  vaByName.set(norm(data.full_name), data);
}
console.log(`Created ${newVANames.length} placed VAs.`);

let inserted = 0;
for (const p of planned) {
  const va = vaByName.get(norm(p.employee));
  const { error } = await supabase.from("va_placements").insert({
    placed_va_id: va.id,
    client_id: p.clientId,
    started_on: p.startedOn,
    va_monthly_rate: p.vaMonthlyRate,
    client_package_amount: p.clientPackageAmount,
  });
  if (error) {
    // 23505 is the (va, client, started_on) unique index — a re-run over
    // rows already imported, which is fine and worth saying so plainly.
    if (error.code === "23505") {
      console.log(`  already present: ${p.employee} / ${p.clientName}`);
      continue;
    }
    console.error(`Couldn't insert ${p.employee} / ${p.clientName}:`, error.message);
    process.exit(1);
  }
  inserted++;
}

console.log(`\nImported ${inserted} placements.\n`);
