# Accounts Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dated team pay, Reports tab renames, Weekly P&L that adds up to the cent (no Promotional, plus an Internal Team section), a searchable project picker, and an "All departments" subscription choice.

**Architecture:** Team pay moves to an effective-dated `member_pay_rates` table read through a pure `src/lib/pay-rates.ts`; every cost figure looks pay up by date. Weekly P&L works each line out from rounded hours and cent rates and sums lines in whole cents. The rest are UI changes plus two small migrations.

**Tech Stack:** TanStack Start + React, TanStack Query, Supabase (Postgres, RLS), shadcn/ui (Popover + Command), vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-accounts-updates-design.md`

## Global Constraints

- Pay in effect on a date = the row with the latest `effective_from` ≤ that date; no row → no pay. A row has an hourly rate, a weekly salary, or neither ("No pay"), never both.
- Seed: hourly → row from `2000-01-01`; salaried → salary row from `salary_from` (no hourly row); `salary_to` set → "No pay" row from the day after. Past figures must come out unchanged.
- The app stops reading/writing `member_employment.hourly_rate`, `weekly_salary`, `salary_from`, `salary_to`. If `member_pay_rates` can't be read, fall back to `payHistoryFromEmployment`.
- Weekly P&L lines: hours rounded to 2 dp, rates to the cent, paid = hours × pay rate and invoiced = billed hours × invoice rate each rounded to the cent, profit = invoiced − paid; totals are sums of lines, done in whole cents. Weekly P&L only — Casual Profit keeps exact time.
- Weekly P&L: no Promotional anywhere; Internal Team section is extra and never changes Total profit, Gross profit or GP after wages.
- Reports tab labels: "Casual Performance", "Casual Profit". Inner "Gross profit" lines/headings stay. Billing → Casual Service keeps its name.
- Migrations safe to re-run; `src/integrations/supabase/types.ts` updated by hand; integration tests for every new table/constraint.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, via `git commit -F <file>`. Don't write `\u` escapes in Write/Edit tool content (they become literal characters); build such strings another way.

## Review Focus

1. A member with no pay rows at all (new hire, or never priced): costs show as unpriced, not as $0 profit or a crash. Test in Task 2 (`payOn` → nulls) and Task 6.
2. A raise dated mid-week in Weekly P&L: two lines, each checkable; IB wages and salary split by day. Test in Task 6.
3. Mixed billable and non-billable entries for one VA and client in a week: separate lines, so invoiced = billed hours × rate holds on each. Test in Task 6.
4. Removing the only pay row, or adding a change on a date that already has one: the dialog says it replaces, and costs follow. Test in Task 3 (unique constraint) and Task 5 (replace via upsert).
5. A subscription marked All departments then given a team: the check rejects it; the form clears one when the other is chosen. Test in Task 10.

---

### Task 1: Placement rates to the cent

**Files:**
- Create: `supabase/migrations/20261030100000_placement_rates_to_cents.sql`
- Test: `src/lib/workspace/rpc.integration.test.ts` (in `describe("va_placements employment_type")`)

- [ ] **Step 1: Integration test** "stores placement rates to the cent": manager updates `va_hourly_rate: 7.93275, client_hourly_rate: 11.6827` → reads back `7.93` and `11.68`.
- [ ] **Step 2: Migration:** `ALTER TABLE public.va_placements ALTER COLUMN va_hourly_rate TYPE numeric(12,2) USING round(va_hourly_rate, 2)`, same for `client_hourly_rate`. Comment: accounts' sheet uses cent rates (40 h × $13.63 = $545.20); the six-decimal rates came from converting monthly packages (20261011030000, 20261016030000).
- [ ] **Step 3: Verify** `npx tsc --noEmit` passes (types unchanged: still `number`).
- [ ] **Step 4: Commit.**

### Task 2: Pay history logic

**Files:**
- Create: `src/lib/pay-rates.ts`, `src/lib/pay-rates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PAY_FROM_THE_START = "2000-01-01";
  export type PayRateRow = { id?: string; userId: string; effectiveFrom: string; hourlyRate: number | null; weeklySalary: number | null };
  export type PayOnDate = { hourlyRate: number | null; weeklySalary: number | null };
  export function payOn(history: PayRateRow[], date: string): PayOnDate;
  export function salaryForRange(history: PayRateRow[], from: string, to: string): { days: number; salary: number };
  export function payHistoryFromEmployment(e: Pick<WorkspaceEmployment, "userId" | "hourlyRate" | "weeklySalary" | "salaryFrom" | "salaryTo">): PayRateRow[];
  export function groupPayHistory(rows: PayRateRow[]): Map<string, PayRateRow[]>; // per user, sorted by effectiveFrom
  ```
- [ ] **Step 1: Failing tests:**
  - `payOn`: history `[{2000-01-01, 6}, {2026-11-02, 6.5}]` → `2026-11-01` gives 6, `2026-11-02` gives 6.5; empty history → `{hourlyRate: null, weeklySalary: null}`; date before the first row → nulls; unsorted input works.
  - `salaryForRange`: salary 700 from 2026-10-01, week 2026-10-19..25 → `{days: 7, salary: 700}`; raise to 770 from Wed 2026-10-21 → `{days: 7, salary: 200 + 550}` (2 days × 100 + 5 days × 110); "No pay" from 2026-10-24 → `{days: 5, salary: 500}`; hourly-only history → `{days: 0, salary: 0}`.
  - `payHistoryFromEmployment`: hourly 6 → `[{2000-01-01, hourly 6}]`; salary 700 from 2026-09-01 to 2026-09-30, hourly 6 also set → `[{2026-09-01, salary 700}, {2026-10-01, neither}]`; nothing set → `[]`.
- [ ] **Step 2: Run** `npx vitest run src/lib/pay-rates.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.** `salaryForRange` walks the days, adding `weeklySalary / 7` for each day a salary is in effect.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 3: `member_pay_rates` table and hook

**Files:**
- Create: `supabase/migrations/20261030110000_member_pay_rates.sql`, `src/lib/workspace/use-pay-rates.ts`
- Modify: `src/integrations/supabase/types.ts` (Tables: `member_pay_rates`), `src/lib/workspace-store.tsx` (context), `src/lib/workspace/rpc.integration.test.ts` (new describe)

**Interfaces:**
- Consumes: Task 2's `PayRateRow`, `groupPayHistory`, `payHistoryFromEmployment`.
- Produces (workspace context):
  - `payHistoryByUser: Map<string, PayRateRow[]>` — from the table; when the query fails, built from `employment` with `payHistoryFromEmployment`.
  - `setPayRate(input: { userId: string; effectiveFrom: string; hourlyRate: number | null; weeklySalary: number | null }): Promise<void>` — upsert on `(user_id, effective_from)`, `.select("id")`, zero rows → `"Only managers and admins can change pay."`.
  - `removePayRate(id: string): Promise<void>`.

- [ ] **Step 1: Integration tests** (`describe("member_pay_rates")`, own plain member): manager inserts and reads a row; a row with both `hourly_rate` and `weekly_salary` → `23514`; a second row on the same user and date → `23505`; plain member reads `[]` and insert → `42501`; pending manager reads `[]`.
- [ ] **Step 2: Migration:** table per spec (FK `profiles(id)` ON DELETE CASCADE, numeric(10,2) ≥ 0 checks, the one-of check, `UNIQUE (user_id, effective_from)`), `REVOKE ALL … FROM PUBLIC, anon, authenticated`, grants, RLS `member_pay_rates_manage` FOR ALL using `can_manage(auth.uid())`. Seed with `INSERT … SELECT … ON CONFLICT DO NOTHING` per the Global Constraints. `COMMENT ON COLUMN` the four superseded `member_employment` columns.
- [ ] **Step 3: types.ts** Row/Insert/Update/Relationships for `member_pay_rates`, in alphabetical place.
- [ ] **Step 4: Hook** `usePayRatesData(enabled, canManage, uid, employment)`: query `["member_pay_rates"]` (fetchAllRows, order `user_id`, `effective_from`, `id`), realtime channel like use-placements, fallback on error (`console.error` once). Wire into the store.
- [ ] **Step 5: Verify** `npx tsc --noEmit`, `npx vitest run`.
- [ ] **Step 6: Commit.**

### Task 4: Reports and the person panel read pay by date

**Files:**
- Modify: `src/routes/reports.tsx` (~661 By employee amount, ~1077 priced profit entries, ~1305 salaried members, ~1328 and ~1421 salary accrual), `src/components/detail-panel.tsx:215-230`

**Interfaces:**
- Consumes: `payHistoryByUser`, `payOn`, `salaryForRange` (Tasks 2–3).

- [ ] **Step 1:** Priced profit entries: `const pay = payOn(history, e.date)`; `payRate = pay.hourlyRate`, `salaried = pay.weeklySalary !== null`.
- [ ] **Step 2:** Salaried members = members with any salary row in their history; accrual per week = `salaryForRange(history, week.from, week.to)` (headcount when `days > 0`).
- [ ] **Step 3:** By employee amount: when `detailedEntries` is loaded, Σ over the member's billable entries of `seconds / 3600 × payOn(history, date).hourlyRate`; null when every billable entry is unpriced; otherwise (not loaded) `billableHours × payOn(history, to).hourlyRate`.
- [ ] **Step 4:** Detail panel shows `payOn(history, today)`: "$x/wk salary" or "$x/hr", with "since <date>" when the row's date isn't `PAY_FROM_THE_START`.
- [ ] **Step 5: Verify** `npx tsc --noEmit`, `npx vitest run`, `npx eslint src`.
- [ ] **Step 6: Commit.**

### Task 5: Manage → Schedule pay cell and dialog

**Files:**
- Create: `src/components/pay-history-dialog.tsx`
- Modify: `src/routes/manage.tsx` (schedule row ~1150–1420: remove rate/salary/salaryFrom/salaryTo state, inputs and saves; add the Pay cell; the table header)

**Interfaces:**
- Consumes: `payHistoryByUser`, `setPayRate`, `removePayRate`, `payOn`, `PAY_FROM_THE_START`.
- Produces: `PayHistoryDialog({ member: { id: string; name: string }, open, onOpenChange })`.

- [ ] **Step 1:** Pay cell: current pay (`payOn(history, today)`) as "$6.00/hr" / "$450.00/wk salary" / "No pay set", "since 3 Nov 2026" unless from the start, and a **Change pay…** button.
- [ ] **Step 2:** Dialog: history table (From — "From the start" for `PAY_FROM_THE_START` — Pay, Remove), and a form: Effective from (date, default today), Pay (Hourly rate / Weekly salary / No pay), Amount (hidden for No pay, ≥ 0, required otherwise). If the date already has a row, show "This replaces the change on <date>." Save → `setPayRate`; toast; keep the dialog open showing the new row.
- [ ] **Step 3: Verify** `npx tsc --noEmit`, `npx eslint src`, `npm run build`.
- [ ] **Step 4: Commit.**

### Task 6: Weekly P&L lines to the cent, by-date pay, no Promotional

**Files:**
- Modify: `src/lib/weekly-financials.ts`, `src/lib/weekly-financials.test.ts`, `src/routes/reports.tsx` (~1550 inputs; CSV hours/count formatting ~1690)

**Interfaces:**
- Consumes: `payOn`, `salaryForRange`, `PayRateRow`.
- Produces: `WeeklyFinancialsInput` gains `payHistoryByUser: Map<string, PayRateRow[]>`; `WeeklyDepartmentKey` loses `"promotional"`; row keys for entries become `entry:${userId}:${clientId ?? "none"}:${payRate}:${invoiceRate}:${chargeable}`.

- [ ] **Step 1: Update fixtures** — tests build `payHistoryByUser` from `employmentByUser` with `payHistoryFromEmployment`.
- [ ] **Step 2: Failing tests:**
  - placement 40 h at VA rate 7.93 / invoice 11.68 → paid `317.2`, invoiced `467.2`.
  - entry 9.1267 h (32856 s), pay 6, VIP invoice 10 → hours `9.13`, paid `54.78`, invoiced `91.3`.
  - department paid/invoiced/profit and Total profit equal the sum of their rows exactly (a fixture of three awkward rows).
  - raise from Wed: two entries Mon (pay 6) and Thu (pay 6.5) for one VA and client → two rows.
  - billable and non-billable entries for one VA and client → two rows; invoiced = billed × rate on each.
  - IB wages: internal work 2.3333 h (8400 s) at 6 + salary 700 for the week → `13.98 + 700` (hours rounded to 2 dp before × rate).
  - promotional entry → no Promotional department and Total profit unaffected (replaces the "only shows a Promotional row…" test).
  - `weeklyPnlRows` has no "Promotional" labels.
- [ ] **Step 3: Run** `npx vitest run src/lib/weekly-financials.test.ts` → FAIL.
- [ ] **Step 4: Implement.** Accumulate exact hours per line, then finalise each line: `hours2 = round2(hours)`, `billed2 = round2(billed)`, `paid = cents(hours2 × round2(rate))`, `invoiced = chargeable ? cents(billed2 × round2(invoiceRate)) : 0`. Sum in integer cents. IB wages per member and pay rate: `cents(round2(hours) × rate)`; salary per member `cents(salaryForRange(...).salary)`. Skip `promotional` entries entirely.
- [ ] **Step 5: CSV**: summary values with `format: "hours"` → `toFixed(2)`; counts stay integers.
- [ ] **Step 6: Run** → PASS; `npx vitest run`, `npx tsc --noEmit`.
- [ ] **Step 7: Commit.**

### Task 7: Weekly P&L Internal Team section

**Files:**
- Modify: `src/lib/weekly-financials.ts`, `src/lib/weekly-financials.test.ts`, `src/components/reports/weekly-pnl-view.tsx`, `src/routes/reports.tsx` (input + CSV)

**Interfaces:**
- Produces:
  ```ts
  type InternalTeamRow = { key: string; clientId: string | null; internal: boolean; personId: string; hours: number; billedHours: number; payRate: number | "salaried" | null; paid: number };
  // WeeklyFinancials gains:
  internalTeam: { rows: InternalTeamRow[]; clients: number; vas: number; hours: number; paid: number };
  // WeeklyFinancialsInput gains:
  internalClientId: string | null; // the client named "Louis Swart", if there is one
  ```
- [ ] **Step 1: Failing tests:** an internal-staff entry on a client → an Internal Team row with that client; internal work and work on the `internalClientId` client → one row with `internal: true`; a `staffType: "placement"` member → no row; promotional → no row; salaried → `payRate: "salaried"`, `paid: 0`; Total profit / Gross profit / GP after wages identical with and without the section's data; summary lines "Internal Team clients/VAs/hours/paid" come after "GP after wages".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `buildWeek` (same line rules as Task 6; key `${userId}:${internal ? "louis-swart" : clientId}:${payRate}`); `weeklyPnlRows` appends the four lines.
- [ ] **Step 4: View:** an "Internal Team" block after the departments' detail tables: Client (internal → "Louis Swart") · VA · Hours · Billed hours · Pay rate ("Salary" for salaried) · Paid.
- [ ] **Step 5: CSV:** after the department lines, rows with department "Internal Team", blank Invoice Rate / Invoiced / Gross Profit.
- [ ] **Step 6: reports.tsx input:** `internalClientId` = the client whose name normalises to "louis swart" (`normaliseClientName` isn't on this branch: compare `name.trim().toLowerCase()`).
- [ ] **Step 7: Verify** `npx vitest run`, `npx tsc --noEmit`, `npx eslint src`.
- [ ] **Step 8: Commit.**

### Task 8: Reports tab renames

**Files:**
- Modify: `src/routes/reports.tsx:2194-2195` (tab labels), `:2030` (`ironbrij-casual-service-by-` → `ironbrij-casual-performance-by-`), `:1805` (`ironbrij-gross-profit-by-` → `ironbrij-casual-profit-by-`), `src/components/reports/casual-report-view.tsx:156` ("Casual Service ·" → "Casual Performance ·").

- [ ] **Step 1:** Make the changes; grep `src/routes/reports.tsx` and `src/components/reports` for any other user-facing "Casual Service" / "Gross Profit" naming the tab itself and change those only.
- [ ] **Step 2: Verify** `npx tsc --noEmit`, `npx vitest run`.
- [ ] **Step 3: Commit.**

### Task 9: Searchable project picker

**Files:**
- Create: `src/components/project-picker.tsx`
- Modify: `src/routes/time.tsx:384-410`, `src/components/entry-form-dialog.tsx:339-370`

**Interfaces:**
- Produces: `ProjectPicker({ id?, value, onChange, recent: WorkspaceProject[], rest: WorkspaceProject[], noneOption?: { value: string; label: string }, disabled?, invalid?, ariaLabel? })` — Popover + Command; search matches project and client name; groups "Recent" and "All projects"; colour dots.

- [ ] **Step 1:** Build it on `@/components/ui/popover` and `@/components/ui/command` (as `combobox.tsx` does).
- [ ] **Step 2:** Time page: replace the Select (keep `NO_PROJECT` as `noneOption`). Entry form: replace the Select (no `noneOption`), keep the error props.
- [ ] **Step 3: Verify** `npx tsc --noEmit`, `npx eslint src`, `npm run build`.
- [ ] **Step 4: Commit.**

### Task 10: Subscriptions — All departments

**Files:**
- Create: `supabase/migrations/20261030120000_subscription_all_departments.sql`
- Modify: `src/integrations/supabase/types.ts`, `src/lib/workspace/types.ts` (`allDepartments: boolean`), `src/lib/workspace/use-subscriptions.ts` (select `*`, read `s.all_departments ?? false`, write it), `src/routes/subscriptions.tsx` (choice, summary line, total label, table), `rpc.integration.test.ts`

- [ ] **Step 1: Integration test:** manager inserts `all_departments: true` → ok; with a `team_id` too → `23514`.
- [ ] **Step 2: Migration:** `ADD COLUMN IF NOT EXISTS all_departments boolean NOT NULL DEFAULT false`; drop-if-exists + add `CHECK (NOT all_departments OR team_id IS NULL)`.
- [ ] **Step 3: App:** `ALL_TEAMS = "__all__"` choice "All departments" in the form (sets `allDepartments: true, teamId: null`); summary groups `allDepartments` under its own "All departments" line; the grand-total line is labelled "Total"; table shows "All departments".
- [ ] **Step 4: Verify** `npx tsc --noEmit`, `npx vitest run`, `npx eslint src`, `npm run build`.
- [ ] **Step 5: Commit.**

### Task 11: Finish

- [ ] Update the accounts SOP doc: Rates and settings (team pay now has a start date: Change pay…), Weekly reporting (Casual Performance / Casual Profit names, Weekly P&L Internal Team section, no Promotional).
- [ ] Ask the user to push `feat/accounts-updates` (pushing was blocked last time).
