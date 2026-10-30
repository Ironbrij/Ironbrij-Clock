# Accounts updates: dated team pay, report renames, Weekly P&L fixes, project search, all-department subscriptions

Status: design, awaiting review (2026-10-30)

A list of updates from the accounts side. "Update remaining hours in projects"
is the separate `feat/remaining-hours-import` branch and isn't covered here.

## 1. Team pay rates from a date

**Problem.** Manage → Schedule holds one hourly rate (or one weekly salary) per
team member in `member_employment`. When a VA gets a raise, changing the rate
rewrites every past week in every report, because every cost figure reads the
one current number. Client invoice rates don't have this problem: `billing_rates`
are effective-dated.

**Decided (product owner, 2026-10-30):** pay changes take an effective date.
Work before the date keeps the old pay; work from the date uses the new. This
covers hourly rates and weekly salaries.

**Data.** New table `member_pay_rates`:

| column | |
|---|---|
| `id` | uuid PK |
| `user_id` | uuid, `profiles(id)` ON DELETE CASCADE |
| `effective_from` | date NOT NULL |
| `hourly_rate` | numeric(10,2), ≥ 0 |
| `weekly_salary` | numeric(10,2), ≥ 0 |
| `updated_by`, `updated_at`, `created_at` | as elsewhere |

- `CHECK (hourly_rate IS NULL OR weekly_salary IS NULL)`: a row is hourly,
  salaried, or neither ("no pay from this date", used when someone leaves).
- `UNIQUE (user_id, effective_from)`.
- The pay in effect on a date is the row with the latest `effective_from` on or
  before it. No row → no pay set.
- RLS: same as `member_employment_manage` (managers and admins, read and write).
  `REVOKE ALL` first, as the newer tables do.

**Seeding** (same migration), chosen so every past figure comes out exactly as
it does today:

- Hourly member (`hourly_rate` set, no salary): one row from `2000-01-01`
  ("from the start").
- Salaried member: one salary row from `salary_from`. No hourly row before it,
  because today a salaried member's entries cost 0 on every date.
- `salary_to` set: a "no pay" row from the day after it.

The old `member_employment` columns (`hourly_rate`, `weekly_salary`,
`salary_from`, `salary_to`) stay in the table but the app stops reading and
writing them. `COMMENT ON COLUMN` marks them superseded.

**Logic** (new pure module `src/lib/pay-rates.ts`, unit-tested):

- `payOn(history, date)`: `{ hourlyRate, weeklySalary }` in effect, or null.
- Salaried on a date = `weeklySalary` in effect is not null. Their entries
  cost 0, as today.
- Salary for a week = Σ over its days of (salary in effect that day ÷ 7), so a
  mid-week raise splits the week.
- `payHistoryFromEmployment(employment)`: the same seeding rules in TS. Used as
  a fallback when `member_pay_rates` can't be read (app deployed a moment
  before its migration), so costs never drop to zero.

Every place that reads `employment.hourlyRate` / `weeklySalary` /
`salaryAccrualForWeek` switches to the history: Reports (By employee payroll,
Casual Profit lines, Casual Performance), Weekly P&L, the person detail panel,
and Manage → Schedule.

**UI (Manage → Schedule).** The Rate and Salary inputs are replaced by one Pay
cell showing the current pay ("$6.00/hr" or "$450.00/wk salary", with "since 3
Nov 2026" when it started after the seed date) and a **Change pay…** button. It
opens a dialog that lists the member's pay history (from date, pay, a remove
button) and a form to add a change: **Effective from** (default today), **Pay**
(Hourly rate / Weekly salary / No pay) and the amount. Saving a change on a
date that already has one replaces it, and the form says so.

## 2. Report tab renames

On Reports only: "Casual Service" → **Casual Performance**, "Gross Profit" →
**Casual Profit**. The tab labels and their CSV file names change. The "Gross
profit" lines and column headings inside the reports stay as they are, and the
Billing → Casual Service tab keeps its name.

## 3. Weekly P&L

### 3a. Cents add up

The 19–25 Oct 2026 export showed 22 of 60 lines that don't check out with a
calculator, and totals a cent or two off their rows. Causes:

1. Ten placements' rates are stored with up to six decimals (from converting
   monthly packages in Oct 2026) but shown to two: 40 h × $7.93 shows $317.31.
2. The internal team's hours are shown to two decimals, but money is worked
   out from the exact seconds: 9.13 h × $6.00 shows $54.76.
3. Totals add unrounded amounts: Full Time profit $1,758.61 against rows
   adding to $1,758.62.
4. The CSV prints raw numbers: "IB staff total hours" 155.78750000000005.

**Decided:** accounts' sheet uses rates to the cent (40 h × $13.63 = $545.20).
So:

- **Data:** round `va_placements.va_hourly_rate` and `client_hourly_rate` to the
  cent and change both columns to `numeric(12,2)`, so they stay that way.
- **Each line** is worked out from what it shows: hours rounded to 2 decimals,
  rates to the cent, paid = hours × pay rate and invoiced = billed hours ×
  invoice rate, each rounded to the cent, profit = invoiced − paid.
- **Lines split when a rate changes mid-week** (a dated raise or a new invoice
  rate), so every line has one pay rate and one invoice rate and can be checked.
- **Totals** are sums of the rounded lines, done in whole cents. Department
  paid/invoiced/profit, Total profit, Gross profit, IB staff wages (each
  member's hourly wages and salary rounded to the cent first) and GP after
  wages. Percentages come from the rounded totals.
- **Export:** hours to 2 decimals, money to 2, percentages to 2.

This is Weekly P&L only. Casual Profit keeps working from exact time, so the
two reports can still differ by a few cents. That was already the case.

### 3b. Promotional left out

The Promotional department disappears from Weekly P&L: no rows, no summary
lines, nothing in the totals. Promotional work is also left out of the new
Internal Team section.

### 3c. Internal Team section

**Decided:** the internal team gets its own section with one row per client and
VA for the week. Columns: **Client · VA · Hours · Billed hours · Pay rate ·
Paid**. No invoice rate, invoiced or profit. Internal tasks show **Louis
Swart** as the client.

- Who: members whose staff type is *internal* (Manage → Schedule). Members
  marked *placement* aren't in it.
- What: every entry of theirs in the week, client work and internal work
  ("internal" by `departmentFor`, or no client) alike. Internal work goes on
  one Louis Swart row per VA. Rows are keyed by the client shown, so work
  logged against the actual "Louis Swart" client lands on that same row
  rather than a second one with the same name.
- Billed hours: with the Paid Casual increment where it applies, otherwise the
  same as hours.
- Same line and rounding rules as 3a. A salaried member shows "Salary" as the
  pay rate and no Paid figure, because their salary is counted once, under IB
  Core Team.
- It's an extra view: client work still counts in the Casual/VIP/etc.
  departments, and the section adds nothing to Total profit, Gross profit or
  GP after wages.
- Summary lines (screen and CSV), after the IB lines: **Internal Team clients**,
  **Internal Team VAs**, **Internal Team hours**, **Internal Team paid**. In the
  CSV's line list, its rows have department "Internal Team" and blank invoice
  columns.

## 4. Project search on the Time page

The project picker on the timer bar is a plain dropdown. It becomes a
searchable picker (Popover + Command, as the existing `Combobox` uses): typing
filters by project name or client name, "No project" stays the first choice,
and the **Recent** group and colour dots stay. The add/edit entry form on the
same page gets the same picker.

## 5. Subscriptions: All departments

When adding or editing a subscription, Department gets an **All departments**
choice, next to the teams and "No department".

- New column `subscriptions.all_departments boolean NOT NULL DEFAULT false`,
  `CHECK (NOT all_departments OR team_id IS NULL)`.
- **Decided:** in the monthly-spend-by-department summary it's its own
  **All departments** line, not split across teams. The summary's grand-total
  line, which is labelled "All departments" today, becomes **Total**.
- The table's Department column shows "All departments".

## Database changes

One migration per area, each safe to re-run:

1. `member_pay_rates` + seed + column comments.
2. Placement rates to the cent (`ALTER COLUMN … TYPE numeric(12,2) USING round(…, 2)`).
3. `subscriptions.all_departments`.

`src/integrations/supabase/types.ts` updated by hand. Integration tests for the
new table's RLS (manager can write and read; plain member and pending account
can't) and the `all_departments` check.

**Deploy order.** The app must keep working for the moment it's live before its
migrations: pay history falls back to `payHistoryFromEmployment`; a missing
`all_departments` reads as false.

## Tests

- `pay-rates.test.ts`: rate in effect on/before/after a change; a mid-week
  salary raise; "no pay" rows; the employment fallback matches the seed rules.
- `weekly-financials.test.ts`: the 19–25 Oct cases (40 h × $7.93 = $317.20;
  9.13 h × $6.00 = $54.78), totals equal the sum of rows, a mid-week raise
  splits a line, Promotional absent, the Internal Team section's rows and that
  it leaves the totals alone, Louis Swart for internal work, salaried shows
  "Salary".
- Integration: `member_pay_rates` RLS and constraints; `all_departments` check.

## Calls made without the product owner (check these)

- Salaried staff's pay history works the same way as hourly (the playback
  guess, confirmed as "all good").
- A "No pay" change replaces the separate salary end date.
- Only Reports' tab names change, plus their CSV file names.
- Weekly P&L rows split when a rate changes mid-week.
- Promotional work is also left out of the Internal Team section.
- The Internal Team section is internal staff type only, and adds four summary
  lines.
- The entry form's project picker gets search too.
- The subscriptions summary's grand total is renamed "Total".
- All of it goes on one branch, `feat/accounts-updates`, one commit per area.

## Left to the builder

Dialog layout, the pay cell's wording, the picker's styling, and test fixtures.
