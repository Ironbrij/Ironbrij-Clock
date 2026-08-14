# Ironbrij Time-Tracking Logic & Workflow Audit

Original audit performed 2026-08-11 against `src/lib/workspace/*`, `src/routes/*`, and `supabase/migrations/*`. Statuses below reflect what's shipped since.

**Framing note:** there is no discrete "clock in/out" or "Attendance" concept in this app. Everything is built on two primitives — a live **timer** (`start_time`/`end_time` on `time_entries`) and **manual entries** — plus a weekly **timesheet** submit/approve state machine layered on top.

---

## 1. Critical Issues — all fixed

**C1. ✅ Fixed.** Managers/admins could approve their own submitted timesheet (`shares_team(x, x)` is trivially true for oneself). Fixed in `review_timesheet()` — self-review now raises an exception — and `pendingApprovals` filters out the viewer's own id.

**C2. ✅ Fixed.** A single click could leave the workspace with zero admins — `set_member_role()` had no last-admin guard. Fixed: demoting the last active admin is now blocked server-side, and the signed-in admin's own row shows a static badge instead of an editable role selector.

**C3. ✅ Fixed.** No DB constraint stopped multiple concurrent active timers per user (only in-memory client state guarded it). Fixed via `CREATE UNIQUE INDEX time_entries_one_running_per_user ON time_entries (user_id) WHERE end_time IS NULL`.

**C4. ✅ Fixed.** No overlap validation on time entries. Fixed via a Postgres `EXCLUDE` constraint (`btree_gist`, `tstzrange(start_time, end_time)`) plus a client-side pre-check for a friendlier error.

**C5. ✅ Fixed.** Approvers couldn't see what they were approving — just a name and an aggregate total. Fixed: Approvals queue rows are now expandable to show the actual entries (project/task/description/duration) behind the total.

---

## 2. High-Priority Issues — all fixed

**H6. ✅ Fixed.** Submitted weeks stayed fully editable until approved (`week_is_locked()` only fired on `status = 'approved'`). Fixed: locking now triggers at `submitted`, not just `approved`; Edit/Delete are hidden (with a lock icon) for entries in a locked week.

**H7. ✅ Fixed.** Timesheets could be submitted with a timer still running for that week, silently swallowing that time (running entries contribute 0 to the total). Fixed: `submit_timesheet()` now blocks submission while a running entry exists in the target week; the Submit button explains why when disabled.

**H8. ✅ Fixed.** Working across midnight was unhandled — a timer run 11pm→3am attributed 100% of its duration to the start day, misattributing hours across week boundaries. Fixed: `stopTimer` now splits the entry at each local-day boundary (`splitByDay`) into separate rows before persisting.

**H9. ✅ Fixed.** Multi-tab/device state never reconciled — no realtime subscription, so a stale tab wouldn't learn a timer started/stopped elsewhere without a manual refetch. Fixed: Supabase Realtime enabled on `time_entries` (filtered to the user) and `timesheets` (unfiltered, RLS-scoped), invalidating the relevant query on any change.

**H10. ✅ Fixed.** History views silently showed wrong (empty) data past a hardcoded 60-day window, indistinguishable from a genuinely empty week. Fixed: history window extended to 400 days, with the Grid/Timesheet week-nav disabling further back-paging and explaining why once you hit the edge.

**H11. ✅ Fixed.** No UI existed for a manager/admin to view or edit an individual employee's time entries, despite the backend fully supporting it (RLS on `time_entries` already granted admins/same-team managers SELECT/UPDATE/DELETE on anyone's rows). Fixed: a new Manage → Entries tab lets a manager/admin pick a team member and week, and view, edit, or delete that person's entries — reusing the existing `updateEntry`/`deleteEntry` client functions (neither was ever scoped to the signed-in user; they always relied on RLS) and the same edit dialog now shared with the personal Time page (`src/components/entry-form-dialog.tsx`). A manager (not admin) still can't touch a locked (submitted/approved) week, matching the backend; an admin can, same as everywhere else in this app.
- Corollary addressed: these edits are now audited. A new trigger (`log_time_entry_edit_by_other`, `supabase/migrations/20260812020000_log_time_entry_edits_by_other.sql`) logs to `activity_log` whenever a `time_entries` UPDATE/DELETE's actor differs from the entry's owner — routine self-edits are untouched, only manager/admin-on-someone-else edits are logged. Shows up in Manage → Activity as "edited"/"deleted … entry for …".

**H12. ✅ Fixed.** Admin policy toggles ("Require descriptions", "Allow manual time entry") were pure client-side checks, bypassable via direct API calls. Fixed: enforced server-side via RLS `WITH CHECK` clauses referencing `workspace_settings`, admin-overridable.

---

## 3. Medium-Priority Issues — all fixed

**M13. ✅ Fixed.** "Repeat" (↻ on a past entry) called `startTimer` directly with the old `projectId`, with no archived check — unlike the normal project pickers, which always filter `!p.archived`. Now blocked with a clear error.

**M14. ✅ Fixed.** `updateEntry` had a latent bug for running entries — a date/start-time patch with no explicit end fell back `existingEnd` to `existingStart`, forcing `minutes = 0` and throwing the misleading "End time must be after start time." Fixing this also uncovered a real bug it was hiding: `updateEntry`'s fallback lookup only ever checked the *caller's own* entries, which broke every manager/admin edit of someone else's entry (H11) the moment the dialog supplied a full patch. Both fixed together — see `use-time-entries.ts`.

**M15. ✅ Fixed.** Reports' overtime column compared everyone against one workspace-wide `weeklyHours`, ignoring `member_employment.employment_type`. Per product decision, there's no stored expected-hours-per-week for part-time staff (only a free-text schedule note), so overtime is now `null` ("—" / "N/A") for anyone marked part-time rather than guessing a fraction of the full-time number.

**M16. ✅ Fixed.** Delete confirmations for a project, tag, and team didn't say how many records they'd affect. Project delete now shows total hours that will lose their project attribution; tag delete shows the entry count; team delete shows member and project counts (deleting a team also `SET NULL`s any of its projects' `team_id`, which the dialog never mentioned before). Client delete already showed its project count.

**M17. ✅ Fixed.** No duplicate-name protection existed for teams, tags, or task categories (clients alone had a DB `UNIQUE`). Added case-insensitive unique indexes plus friendly error messages on create/update.

**M18. ⚠️ Improved, not fully closed.** Forgotten-clock-out protection was entirely client-side. Per product decision, no auto-stop was added (no pg_cron/Edge Functions infra in this repo, and silently closing out payroll-adjacent records isn't a call to make unprompted) — instead, Manage → Entries now shows an "Active timers" card: every currently-running timer visible to a manager/admin under existing RLS, flagged past 8h, polling every 60s. Passive visibility only, not a fix for the underlying gap.

**M19. ✅ Fixed.** "Approve" fired immediately with no confirmation, while "Send back" already opened one — inverted risk framing, since `review_timesheet()` has no admin exception for un-approving an already-approved row (nothing can undo Approve at all, not even for admins). Approve now opens a confirmation dialog naming the person, week, and hours involved.

---

## 4. Low-Priority Issues — all fixed

**L20. ✅ Fixed.** No future-dated entry validation — the date input's `max` was a UI hint only. Added a DB `CHECK` bounding `time_entries.start_time` to no more than a day past `now()` (bounded on the instant, not `entry_date`, to tolerate timezone skew without false rejections).

**L21. ✅ Fixed (labeling, not a real feature).** "Time off" was 100% mock data with a dead "Request time off" button. Building a real leave/attendance workflow is well beyond a low-priority fix, so this was made honest instead, matching the pattern Settings → Admin → Danger zone already used: a banner explaining the page is sample data, the button disabled with an explanatory title. Settings → Notifications toggles and "Change avatar" got the same treatment (previously silently non-functional, no indication why).

**L22. ✅ Fixed.** Calendar view (Time page) had no navigation at all, hardcoded to "today." Added independent month/week paging plus a "Today" reset, bounded by the same `oldestLoadedWeekStart()` rule Grid/Timesheet already use.

**L23. ✅ Fixed.** Settings → Admin: entering `0` for weekly hours was treated as falsy (`Number(weeklyHours) || settings.weeklyHours`) and silently reverted on save. Now validated explicitly, with an error message instead of a silent revert.

**L24. ✅ Fixed.** `member_employment.hourly_rate` had only client-side non-negative validation. Added a DB `CHECK` constraint (nullable still allowed).

---

## 5. Edge Cases — Pass/Fail Against the Original Prompt's List

| Edge case | Status | Note |
|---|---|---|
| Multiple active timers | ✅ Fixed | C3 — unique partial index |
| Overlapping time entries | ✅ Fixed | C4 — EXCLUDE constraint |
| Double clock-in (same tab) | ✅ OK | Button state is server-derived |
| Clocking out without clocking in | ✅ OK | `stopTimer` is a no-op if no matching entry is found |
| Forgotten clock-outs | ⚠️ Improved | M18 — manager/admin visibility added, still no server-side auto-stop |
| Browser refresh during active timer | ✅ OK | Elapsed time correctly reconstructed from stored `start_time` |
| Browser closing during active timer | ⚠️ Partial | Data is safe, but no warning fires anywhere (ties to M18) |
| Network failure during tracking | ⚠️ Partial | Throws a toast, leaves state as-is (safe default), but no retry/offline queue |
| Switching projects while tracking | ⚠️ By design, unclear | Pickers are `disabled={running}`; not explained to the user why |
| Editing an active timer | ✅ Fixed | M14 — running entries now rejected with a clear error instead of a silent 0-minute bug |
| Deleting an active timer | ✅ Blocked in UI | Delete button hidden while running |
| Working across midnight | ✅ Fixed | H8 — split at day boundaries |
| Editing approved/submitted timesheets | ✅ Fixed | H6 — locked at submission, admin override remains |
| Manager modifying employee records | ✅ Fixed | H11 — Manage → Entries |

---

## 6. Status Summary

- **Critical (C1–C5):** all fixed.
- **High (H6–H12):** all fixed.
- **Medium (M13–M19):** all fixed — M18 improved (manager visibility) rather than fully closed (no auto-stop, by product decision).
- **Low (L20–L24):** all fixed.

---

## QA / Break the Application Audit

Adversarial pass performed 2026-08-12 against `src/lib/workspace/*`, `src/routes/*`,
`src/components/entry-form-dialog.tsx`, `src/lib/admin.functions.ts`,
`src/integrations/supabase/auth-middleware.ts`, and `supabase/migrations/*`, specifically trying
to break time tracking, timesheets, and permissions rather than review them line by line. Numbering
continues from the original audit above. No code was changed during the audit pass itself; the
three High findings (H13–H15) were fixed in a follow-up pass once reviewed — see each entry below.

### 7. High-Priority Issues

**H13. ✅ Fixed.** A failed background fetch was indistinguishable from a legitimate empty state
everywhere in the app — no global `onError`, no `isError` handling anywhere. Fixed at two levels:
`src/router.tsx` now constructs `QueryClient` with a `QueryCache({ onError })` that toasts
"Couldn't load the latest data" (deduped to one toast via a fixed `id`) whenever *any* query fails,
so a background failure is never silent. Separately, `workspace-store.tsx` now exposes `loadError`
alongside the existing (previously unused) `loading` flag — both derived from the same "core shell"
query set (profile, teams, projects, tags, settings, timesheets, task categories) — and `AppShell`
blocks on them: a spinner while loading, a dedicated "Couldn't load your workspace" screen with a
Try again button (calling `refreshAll()`) if one of them errored outright. That covers the worst
case (initial load failing makes every page look genuinely empty) app-wide in one place; the toast
covers everything else (entries, timesheet actions, etc.) that isn't part of the core shell set.

**H14. ✅ Fixed.** Submitting the current, still in-progress week was allowed with no guard,
silently locking out further time tracking for the rest of that week. `SubmissionPanel`
(`src/routes/timesheet.tsx`) now computes `weekInProgress` (`Date.now() < addDays(weekStart, 7)`)
and, if true, opens a confirmation dialog ("This week isn't over yet…") explaining exactly what
submitting now will do — no timer, no manual entries, for the rest of the week, until a manager
reviews it — before calling `submitTimesheet`. Deliberately not a hard block: someone going on leave
for the rest of the week is a legitimate reason to submit early, so this only adds the missing
warning, matching the confirm-before-Approve pattern already established for M19.

**H15. ✅ Fixed.** `profiles.is_active` was never checked by any RLS policy, `has_role()`, or
`can_manage()` — access revocation relied entirely on `deleteUser()` invalidating an already-issued
token, with no app-level backstop. Fixed in
`supabase/migrations/20260812060000_require_active_for_privileged_access.sql`: a new
`is_active_user()` helper, folded directly into `has_role()`/`can_manage()` (every call site across
every migration invokes them as `has_role(auth.uid(), ...)`/`can_manage(auth.uid())` — always a
check on the *caller*, never a target — so this strengthens every policy built on them for free:
every `*_write_manage` policy, `settings_write_admin`, `set_member_role`, `approve_member`,
`review_timesheet`, and the admin/manager branches of every `time_entries`/`timesheets` policy).
The remaining gap those two functions can't cover — the plain `user_id = auth.uid()` self-access
branch — is closed directly on `time_entries` (select/insert/update/delete) and `timesheets_select`,
the two payroll-critical tables this audit's other findings are already about, by wrapping each
policy in `is_active_user(auth.uid()) AND (...)`. A removed member — admin, manager, or plain
member — now loses all access the instant `is_active` flips, regardless of whether their token has
technically expired yet.

### 8. Medium-Priority Issues

**M20. ✅ Fixed.** A running timer belonging to a member whose access has been removed (or who is
otherwise deactivated) becomes a permanently orphaned row that's invisible everywhere in the UI.
`useActiveTimersData` (`src/lib/workspace/use-time-entries.ts`) queries `time_entries` directly for
any row with `end_time IS NULL`, with no `is_active` filter — so the row itself is still fetched.
But both places that surface it filtered through `activeMembers` first. Fixed in
`src/routes/manage.tsx`'s `TeamEntriesTab`: `relevantActiveTimers` now only excludes the viewer's
own timer (`activeTimers.filter((t) => t.userId !== currentUser.id)`) rather than re-filtering
through `relevantMembers` — RLS already scopes `activeTimers` correctly (everyone, for an admin;
shared-team members, for a manager — and a removed person drops out of a manager's shared-team scope
anyway, since `removeUserAccess` deletes their `team_members` rows), so that second, client-side
filter was redundant except for the harm it did here. The member picker's `<Select>` now renders
from a new `selectableMembers` list — `relevantMembers` plus, if the current `memberId` selection
falls outside it (e.g. clicked from the Active Timers card), that specific member appended and
labeled "(inactive)" — so clicking through from the timer card no longer leaves the dropdown
pointing at a value it can't render. The reset effect that used to snap `memberId` back to the
default the moment it left `relevantMembers` now only resets when the id doesn't match any known
member at all, so an explicit selection like this sticks.

**M21. ✅ Fixed.** Manual time entries had no way to represent a shift that crosses midnight —
`EntryFormDialog` combined both `startTime` and `endTime` against the same single `date`, so
22:00→02:00 always computed a negative duration. Fixed with an "Ends after midnight, the next day"
checkbox (add-entry only — an existing stored entry never actually spans midnight in the first
place, since creation already splits it, so there's nothing to toggle back on when editing one).
When checked, `createEntry` (`src/lib/workspace/use-time-entries.ts`) now runs the same
`splitByDay` H8 already established for the live timer, and inserts the resulting one-row-per-day
segments as a single atomic multi-row `insert()` — either the whole shift saves, or none of it
does, avoiding the partial-write risk a per-segment insert loop would have had.

**M22. ✅ Fixed.** `submit_timesheet()` had no server-side check that the week being submitted
actually had any entries — only the client's `hasEntries` flag in `SubmissionPanel` stopped an
empty-week submission. Fixed in
`supabase/migrations/20260812070000_require_entries_to_submit.sql`: the RPC now raises "Log some
time before submitting this week" if there isn't a single `time_entries` row in range, checked
before the existing running-timer guard. Same category of fix as H12 — a business rule that only
existed client-side now has its database backstop too.

**M23. ✅ Fixed.** An admin correcting entries inside an already-approved week never reset or
flagged that week's timesheet status, so the employee's own `SubmissionPanel` kept showing
"Approved — this week is locked" with a total that had silently gone stale. Fixed in
`supabase/migrations/20260812080000_flag_approved_week_modified.sql`: a new
`entries_modified_at` column on `timesheets`, set by an `AFTER INSERT OR UPDATE OR DELETE` trigger
on `time_entries` whenever a completed write touches an entry inside a week that's currently
`'approved'` (checked for both the old and new `entry_date` on an update, so moving an entry into
or out of an approved week is caught either way). Since `week_is_locked()` blocks everyone but an
admin from writing into an approved week at all, this only ever fires for exactly the case M23
describes. The employee's Timesheet page now shows "An admin updated entries in this week on
[date] — after it was approved. The total above reflects that change." underneath the Approved
badge when the flag is set. Deliberately doesn't re-open the week or force re-approval — same
reasoning as M18: that's a real product decision this fix isn't making unprompted, it just makes
the staleness visible instead of silent.

### 9. Low-Priority Issues

**L25. ✅ Fixed.** Settings → Users → pending members' "Approve" and "Resend invite" buttons had no
busy/disabled state during their async call — unlike essentially every other action button in the
app. Fixed in `src/routes/settings.tsx`'s `UsersTab`: replaced the single shared `busyId` string
(which had the same L26-class problem for the Role/Team dropdowns further down in this same file —
fixed alongside this, not left as the one inconsistent spot) with a `busyKeys: Set<string>` keyed
per row-and-action (`role:${id}`, `team:${id}`, `approve:${id}`, `resend:${id}`), so any number of
independent actions can be in flight at once without one clearing another's disabled state early.

**L26. ✅ Fixed.** `ApprovalsPanel`'s `busyId` (`src/routes/manage.tsx`) was a single shared value
covering the entire pending-approvals list, not per-row — acting on a second timesheet while a
first was still in flight overwrote it and re-enabled the first row's buttons early. Fixed the same
way as L25: `busyId` replaced with `busyIds: Set<string>`, so `disabled={busyIds.has(a.id)}` per row
is accurate regardless of how many other rows are simultaneously in flight.

**L27. ✅ Fixed.** Projects, teams, clients, tags, task categories, members, and employment/schedule
data had no Realtime subscription — only `time_entries` and `timesheets` did. Fixed in
`supabase/migrations/20260812090000_enable_realtime_workspace_tables.sql` (adding `profiles`,
`team_members`, `teams`, `clients`, `tags`, `projects`, `project_members`, `project_tags`,
`task_categories`, and `member_employment` to the `supabase_realtime` publication — same
existence-guarded pattern as H9's original `20260812010000_enable_realtime.sql`) plus a matching
`postgres_changes` subscription added to each of `use-projects.ts`, `use-teams.ts`,
`use-clients.ts`, `use-tags.ts`, `use-task-categories.ts`, `use-members.ts`, and
`use-employment.ts` (the last gated on `canManage`, same as its query). `team_members` is
subscribed to once, from `use-members.ts`, rather than duplicated in `use-teams.ts` too.

### 10. Edge Cases — This Pass

| Edge case | Status | Note |
|---|---|---|
| Query/network failure surfaced to the user | ✅ Fixed | H13 — global toast on any query error, plus a dedicated error+retry screen for core-shell load failures |
| Submitting the current (unfinished) week | ✅ Fixed | H14 — confirmation dialog explains the lock-out before submitting; not a hard block |
| Removed user's orphaned running timer | ✅ Fixed | M20 — Active Timers card and Manage → Entries picker both reach it now |
| Manual entry across midnight | ✅ Fixed | M21 — "Ends after midnight" checkbox, split into one row per day like the timer |
| Empty timesheet submitted via direct API call | ✅ Fixed | M22 — `submit_timesheet()` now rejects a week with zero entries server-side |
| Editing an approved week's entries (admin) | ✅ Fixed | M23 — still allowed (payroll corrections), now flags `entries_modified_at` and shows it on the employee's Timesheet page |
| Double-clicking Approve/Resend invite (pending members) | ✅ Fixed | L25 — per-row-and-action busy keys instead of one shared string |
| Concurrent actions across two different pending approvals | ✅ Fixed | L26 — `busyIds` is now a `Set`, not a single shared value |
| Multi-tab drift on projects/teams/clients/members | ✅ Fixed | L27 — Realtime added to all of them |
| Double-clicking Start/Stop Timer | ✅ OK | `busy` state + the `time_entries_one_running_per_user` index both hold |
| Double-submitting Add/Edit entry dialog | ✅ OK | `busy` state + the no-overlap `EXCLUDE` constraint both hold |
| Starting a timer with no project selected | ✅ Blocked in UI | `TimerBar.toggle()` rejects with a toast before calling `startTimer` |
| Starting a timer with no task selected | ⚠️ Unenforced | `startTimer`/DB never require a non-empty `task`; only reachable if a workspace has zero task categories |
| Moving an entry into a locked week via edit | ✅ Blocked | `time_entries_update`'s `WITH CHECK` re-checks `week_is_locked()` against the *new* `entry_date` |
| Un-approving an approved timesheet | ✅ By design (documented) | Still true post-audit — `review_timesheet()` only ever transitions rows currently `'submitted'`, no admin override (see original M19) |

### 11. Status Summary

- **High (H13–H15):** all fixed — a global query-error toast plus a core-shell loading/error gate in
  AppShell (H13), a confirmation dialog before submitting an unfinished week (H14), and
  `is_active` now enforced via `has_role()`/`can_manage()` plus the `time_entries`/`timesheets`
  self-access policies directly, closing the app-level gap that previously relied solely on
  Supabase's own token lifecycle (H15).
- **Medium (M20–M23):** all fixed — the orphaned-timer visibility gap for removed users (M20),
  overnight manual entries via a new checkbox that reuses H8's `splitByDay` (M21), a database-level
  backstop for empty-timesheet submission matching H12's pattern (M22), and a visible
  `entries_modified_at` flag for approved-week corrections (M23).
- **Low (L25–L27):** all fixed — per-row-and-action busy tracking (a `Set` instead of a single
  shared id) closes both L25 and L26 with the same mechanism, and Realtime now covers every
  workspace table that didn't already have it.
- Several categories from the original QA checklist came back clean on this pass: duplicate
  timer/entry submissions, overlapping entries, moving entries into locked weeks, and starting a
  timer without a project are all already enforced at both the client and database layer.

### Files/components inspected this pass

`src/lib/workspace/use-time-entries.ts`, `use-timesheets.ts`, `use-members.ts`, `use-employment.ts`,
`use-settings.ts`; `src/routes/time.tsx`, `timesheet.tsx`, `manage.tsx`, `reports.tsx`, `settings.tsx`,
`login.tsx`, `__root.tsx`; `src/components/entry-form-dialog.tsx`; `src/lib/workspace-store.tsx`;
`src/lib/admin.functions.ts`; `src/integrations/supabase/auth-middleware.ts`; and the full
`supabase/migrations/*` history, with particular attention to `20260804110000_timesheet_approvals.sql`,
`20260811040000_lock_on_submit.sql`, `20260812000000_enforce_entry_policies.sql`,
`20260811030000_time_entries_no_overlap.sql`, `20260805070000_profiles_is_active.sql`, and
`20260811010000_protect_last_admin_role_change.sql`.

**Total issues found this pass: 10** (0 Critical, 3 High, 4 Medium, 3 Low — plus the edge-case
table above covering both new gaps and confirmed-fixed behavior). **All 10 findings from this pass
(H13–H15, M20–M23, L25–L27) are now fixed.**

---

## Clockify Feature Parity Audit

Performed 2026-08-14 against the same surfaces as prior passes (`src/routes/*`,
`src/lib/workspace/*`, `src/components/entry-form-dialog.tsx`, `supabase/migrations/*`), this time
asking a different question: not "is this correct," but "is this enough for Ironbrij to
comfortably stop using Clockify." No code was changed — this is a feature-inventory pass, not a
bug hunt. Numbering continues from the QA audit above; all findings start `⏳ Open`.

**Method:** read every route (`index`, `time`, `timesheet`, `projects`, `teams`, `manage`,
`reports`, `settings`, `time-off`) and every `workspace/use-*` hook end to end, then compared what
exists against Clockify's core feature set — Time Tracking, Timesheets, Projects, Tasks,
Attendance, Breaks, Reports, Teams, User management, Approvals — filtering out anything that's
billing/SaaS/enterprise/integration-shaped and therefore out of scope for an internal tool.

### Framing

The prior audits already established that time tracking, timesheets, and approvals are the
strongest part of this app — timer + manual entry, midnight-splitting, overlap/locking
enforcement, submit → review → approve/reject, and an activity log are all real, defense-in-depth
implementations, not prototypes. This pass found no new correctness bugs in that core. What's
below is genuinely about **feature completeness relative to Clockify**, not robustness.

One piece of context that shapes several calls below: this account has Xero MCP tools configured,
which means Ironbrij already runs its accounting/invoicing through Xero. That's treated as a hard
constraint on scope, not a coincidence — see the "Unnecessary" section.

### 12. Must-Have Gaps

**H16. ⏳ Open. No entry-level ("Detailed") time report.** Reports (`src/routes/reports.tsx`) only
ever offers two *aggregated* views — hours-by-project and hours-by-employee, both pre-summed by
`project_hours_range`/`employee_hours_range` RPCs — with CSV export of those summary rows. There is
no view anywhere in the app that lists individual time entries across people/projects/date ranges
with filters, the way Clockify's Detailed report does. Manage → Entries (`TeamEntriesTab`) and the
Approvals expand-row (`ApprovalEntries`) both show entry-level detail, but only one person/week at
a time — neither is a searchable, exportable, cross-team report.
**Why it matters:** a digital agency billing clients by the hour needs entry-level backup (what was
worked on, by whom, when, described how) to justify an invoice or answer a client's "what did we
pay for" question — a project total alone doesn't support that. This is the single biggest
functional gap relative to Clockify's reporting.
**Recommended behavior:** a third Reports tab — "Detailed" — listing raw entries (date, person,
project, task, description, duration, billable) for the selected range/team/client filters already
on the page, with the same CSV export pattern (`downloadCsv`) the other two tabs use.
**Priority:** High. **Complexity:** Medium — mostly UI; the data (`time_entries`) and filters
already exist, this is a new query + table, not new policy work.

**H17. ⏳ Open. No cost/billing ($) report.** `member_employment.hourly_rate` (Schedule tab,
`manage.tsx`), `projects.is_billable`, and `clients.subscription_hours` all already exist and are
each shown in isolation (Schedule tab, project badges, Client profile dialog) — but nothing
multiplies hours × rate, or rolls billable hours up by client into a dollar figure. Reports shows
hours, never money.
**Why it matters:** Ironbrij is a staffing/VA agency — "how many billable hours did we log for
Client X this month, and what's that worth" is a core operational question, and the underlying data
is already captured. Given the Xero integration noted above, this doesn't need to become an
invoicing feature (see H18/Unnecessary) — it needs to produce a number someone can hand to Xero or
a client, not generate the invoice itself.
**Recommended behavior:** extend the Reports "By employee" and/or a new "By client" view with a
$-amount column (billable hours × that person's `hourly_rate`, workspace `currency`), and surface
subscription-hours remaining (already computed per-client in `ClientProfileDialog`) as a report
filter/column rather than something only visible one client at a time.
**Priority:** High. **Complexity:** Medium — new RPC(s) to join `time_entries` with
`member_employment` and `projects.is_billable`, respecting the same RLS scoping
`employee_hours_range` already does.

**H18. ⏳ Open. No path to bring historical Clockify data across.** There's no CSV/API import
anywhere in the app — every time entry starts empty at rollout.
**Why it matters:** "stop using Clockify" implies Ironbrij's historical hours (for reports,
client history, payroll reference) either migrate or are lost. This blocks the actual cutover more
than any in-app feature gap does.
**Recommended behavior:** doesn't need to be a permanent UI feature — a one-time admin-run import
script (Clockify's own CSV export → `time_entries` rows, mapped by email/project name) is enough,
run once during cutover and then deleted. Flagging it here so it's a deliberate decision, not a
surprise on migration day.
**Priority:** High (blocks cutover). **Complexity:** Low, as a one-off script — avoid building a
permanent importer UI for a need that only exists once.

### 13. Useful Improvements

**M24. ⏳ Open. Time off / leave page is entirely mock data.** `src/routes/time-off.tsx` renders
`timeOffBalances`/`timeOffHistory` from `@/lib/mock-data`, with an honest banner ("this page shows
sample data") and a disabled "Request time off" button — same honesty pattern the original audit's
L21 applied. It's still zero real functionality: no balances table, no request/approve workflow, no
tie-in to the timesheet.
**Why it matters:** Clockify's leave tracking is a real feature Ironbrij may currently rely on; if
so this is a gap, not a nice-to-have. If Ironbrij doesn't actually use Clockify for leave today,
this page is pure clutter pointing at nothing.
**Recommended behavior:** a product decision, not an engineering one — either build a minimal real
version (a `time_off_balances`/`time_off_requests` table, request → manager approve, mirroring the
timesheet approval pattern already proven out) or remove the nav entry entirely. Leaving it
half-real (styled, honest, but non-functional) is the worst of both options long-term.
**Priority:** Medium. **Complexity:** Medium-High if built for real (new tables, RLS, balance
accrual rules); Low if the decision is to remove it.

**M25. ⏳ Open. Task categories are a flat, workspace-wide list — not scoped to a project.**
`task_categories` (Settings → Admin → Task categories, `use-task-categories.ts`) is a single global
list every project shares; `WorkspaceEntry.task` is a free-text label with no `task_id`, estimate,
assignee, or completion state. Clockify's Tasks live *inside* a Project, each with their own
estimate/assignee/status, and a time entry links to a specific task within its project.
**Why it matters:** if Ironbrij's 13 teams work across many client projects with genuinely
different task breakdowns per project (not just "Design / Dev / QA" shared workspace-wide), the
current model can't express that — every project offers the identical task list.
**Recommended behavior:** only worth doing if task lists actually differ meaningfully by project
today in Clockify — worth confirming with the team before building. If so: a `project_task_categories`
join (or per-project override list) rather than a global table.
**Priority:** Medium — contingent on confirming the need first. **Complexity:** Medium.

**M26. ⏳ Open. A time entry's billable status can't be overridden per entry.** `is_billable` is
set once, at insert time, from the project's `is_billable` flag (`use-time-entries.ts`:
`is_billable: project?.billable ?? true`) and is never editable afterward in
`EntryFormDialog`/`updateEntry`. Clockify lets any entry be flagged billable/non-billable
independent of its project's default.
**Why it matters:** a billable project still has genuinely non-billable moments (internal syncs,
rework, training) that currently can't be excluded from that project's billable total without
moving them to a different (non-billable) project, which pollutes project-level reporting.
**Recommended behavior:** add a billable toggle to `EntryFormDialog`, defaulting to the project's
setting but overridable per entry; `updateEntry`/`createEntry` already accept a patch object, so
this is additive.
**Priority:** Medium. **Complexity:** Low — one new column is already present (`is_billable` sits
on `time_entries` already), this is UI + wiring, not schema work.

**M27. ⏳ Open. No project-level budget or estimated-hours tracking.** Clients already have this
(`subscription_hours` + rendered-hours-remaining math in `ClientProfileDialog`,
`src/routes/projects.tsx`), but individual projects don't — a project has no estimate to compare
logged hours against, no progress bar, no "over budget" signal anywhere `projects.tsx` or
`reports.tsx` renders.
**Why it matters:** for fixed-scope or capped-hours project work (as opposed to open retainers,
which the client-level subscription hours already cover), knowing you're approaching or over budget
*before* the invoice is the main reason Clockify's budget feature gets used day to day.
**Recommended behavior:** an optional `budget_hours` (or `budget_amount`) column on `projects`,
surfaced the same way client subscription hours already are — a remaining/over indicator on the
project card and in Reports.
**Priority:** Medium. **Complexity:** Medium.

**M28. ⏳ Open. Reports has no billable vs. non-billable breakdown.** The Dashboard computes a
personal "billable share" percentage (`src/routes/index.tsx`), but Reports — the actual
cross-team, exportable view — never splits hours by billable status at all, on either the project
or employee tab.
**Why it matters:** billable/non-billable is one of the first things anyone reviewing agency
utilization looks for; right now getting that number for anyone but yourself requires no tool at
all in this app.
**Recommended behavior:** an extra column (or stacked-bar split) on both Reports tabs using the
`is_billable` flag already on every entry/project.
**Priority:** Medium. **Complexity:** Low.

**M29. ⏳ Open. Notifications tab is entirely non-functional.** Every switch in Settings →
Notifications (`src/routes/settings.tsx`) is `disabled`, backed by a hardcoded local array, with an
explicit "Coming soon — these preferences aren't saved yet" disclaimer. Nothing in the app sends an
email/push notification for anything — a submitted timesheet, an approval, a long-running timer —
today; awareness relies entirely on someone opening Manage → Approvals or Manage → Entries and
looking.
**Why it matters:** the two entries that would matter most operationally are "a timesheet is
waiting on your review" (closes the loop on Approvals without a manager needing to remember to
check) and the existing "timer still running" warning (already implemented as an in-tab toast in
`TimerBar` — just never leaves the browser tab that started it).
**Recommended behavior:** doesn't need all five listed preferences — start with real delivery
(email, via Supabase's own auth/email infra or a lightweight edge function) for just "timesheet
submitted for your review" and drop the rest of the mocked list until there's a real transport to
back them.
**Priority:** Medium. **Complexity:** Medium — needs an actual email-sending path, which doesn't
exist anywhere in this codebase yet.

### 14. Lower-Priority / Polish

**L30. ⏳ Open. No "copy previous day" or duplicate-entry shortcut.** Repeating a whole day's set of
entries (common for people whose Tuesday looks like their Monday) currently means re-creating each
entry by hand or using the single-entry ↻ Repeat action (`EntryList` in `time.tsx`) one at a time.
**Recommended behavior:** a "Copy yesterday" action on `ListView` that clones the prior day's
entries onto today via `createEntry`, same pattern `repeatEntry` already uses per-entry.
**Priority:** Low. **Complexity:** Low.

**L31. ⏳ Open. Avatar upload is still a disabled placeholder.** `ProfileTab`
(`src/routes/settings.tsx`) shows "Change avatar" disabled with a "coming soon" title — unchanged
since the original audit's L21 pass made the *messaging* honest without building the feature.
**Priority:** Low. **Complexity:** Low (file upload to Supabase Storage + `avatar_url` column,
which already exists on `profiles`).

**L32. ⏳ Open. Weekly schedule is a free-text note, not structured data.** `member_employment
.weekly_schedule` (Manage → Schedule tab) is a single text field ("e.g. Mon–Fri, 9am–5pm") with no
per-day start/end times — fine for display, but nothing can compute against it (e.g., "is this
person rostered right now").
**Priority:** Low. **Complexity:** Low-Medium if structured (per-weekday start/end columns) — not
worth it unless something downstream actually needs to compute against a schedule rather than just
display it.

### 15. Unnecessary — Considered and Rejected

- **In-app Invoices / Expenses** (both currently "coming soon" placeholder tabs in
  Manage — `src/routes/manage.tsx`, `sections` array). Ironbrij already has Xero configured for
  accounting; duplicating invoicing/expense tracking inside IronTrack would compete with, not
  complement, that. The useful subset of "invoices" — a billable-hours-to-dollars figure per client
  — is covered by H17 above without building an invoicing system.
- **Kiosks** (shared PIN clock-in terminals, also a "coming soon" placeholder tab). This is a
  feature for on-site/retail staff clocking in on a shared device; Ironbrij is a VA/staffing agency
  with remote staff, each already signing in individually. No fit.
- **Idle-time / away detection.** Clockify's desktop app detects OS-level idle time and prompts
  "were you away?" — this requires a native/desktop agent process a browser tab structurally can't
  provide. The existing 4/8/12h "still running" toast (`TimerBar`, `time.tsx`) already covers the
  practical case (forgotten timers) this would address.
- **Time rounding / minimum-increment rules.** A real Clockify feature (round entries to nearest 15
  min, etc.) aimed at reducing invoice disputes at scale — unnecessary complexity for an internal
  tool where the underlying entries are the source of truth, not a customer-facing rounded number.
- **A discrete "Break" control.** Clockify offers an explicit pause/break button within a shift.
  This app's model — stop the timer, start a new one later — already expresses a break as the gap
  between two entries with no extra UI needed; adding a dedicated break concept wouldn't change
  what gets recorded, just how it's clicked.
- **Recommendation, not just rejection:** given three of Manage's seven tabs (Expenses, Kiosks,
  Invoices) are permanent "coming soon" placeholders with no build plan, consider removing them
  from the nav rather than leaving dead tabs that promise functionality the team has decided not to
  build — this is the "should be simplified" call-out for this audit. `sections` in `manage.tsx` is
  a single array; deleting three entries is the entire change.

### 16. Status Summary

- **Must-have gaps (H16–H18):** an entry-level Detailed report for client billing backup, a
  cost/billing ($) report joining hours to `hourly_rate`, and a one-time historical-data import path
  from Clockify. None of these are correctness bugs — the underlying data (`time_entries`,
  `hourly_rate`, `is_billable`) already exists; what's missing is a way to see it rolled up.
- **Useful improvements (M24–M29):** real (or removed) time-off tracking, project-scoped tasks,
  per-entry billable override, project-level budgets, a billable/non-billable Reports split, and
  real (if minimal) notification delivery starting with "timesheet awaiting your review."
- **Lower-priority polish (L30–L32):** copy-previous-day, avatar upload, structured weekly
  schedules — all small, none blocking.
- **Unnecessary, explicitly rejected:** in-app invoicing/expenses (Xero already covers this),
  on-site kiosk clock-in (no on-site staff), idle/away detection (needs a desktop agent), time
  rounding rules, and a dedicated break control (already implicit in stop/start) — plus a
  recommendation to remove the three permanently-placeholder Manage tabs (Expenses, Kiosks,
  Invoices) rather than leave them promising unbuilt functionality.
- **Features already covered, at or above Clockify parity for an internal tool this size:** live
  timer + manual entry with midnight-splitting, overlap/locked-week enforcement at both the client
  and RLS layer, weekly timesheet grid/list with submit → review → approve/reject and a visible
  audit trail (`entries_modified_at`, Activity tab), projects/clients/tags with archiving and
  client-level subscription-hours tracking, teams with rostering and bulk invite, three-tier
  role-based user management (invite/approve/remove, last-admin protection, self-role-change
  blocked), Reports summary views with CSV export, and Realtime sync across tabs/devices for every
  mutable table in the workspace.

---

## Smart Automation Audit

Performed 2026-08-14 against the same surfaces as the parity pass (`src/routes/*`,
`src/lib/workspace/*`, `src/components/entry-form-dialog.tsx`), asking a third question: not
"is this correct" and not "is this complete relative to Clockify," but "what small, low-risk
automation would make the daily grind of using this app — starting a timer, submitting a week,
clearing an approvals queue — measurably faster." No code was changed. Numbering continues from
the parity pass above; all findings start `⏳ Open`.

**Ground rule applied throughout:** an automation only made this list if it saves real, repeated
clicks/attention *and* is low-risk to get wrong. Anything that would need real AI, a background job
scheduler, email infrastructure that doesn't exist yet, or guesses at things the app has no data to
know for certain (who's on leave, whether a short entry was a mistake) either got downgraded in
priority with the risk spelled out, or moved to the rejected list at the end.

### 17. Recommendations

**H19. ✅ Fixed.** No proactive reminder for unsubmitted past weeks. Nothing in the app told the
person themselves "you have time logged in a past week that was never submitted." Manage →
Approvals has `WeekStatusPanel` (`src/routes/manage.tsx`), but it's manager-facing, scoped to *this*
week only, and requires a manager to go looking — there was no equivalent pull for an employee's own
Dashboard, and no push at all. Fixed in `src/routes/index.tsx`: a dismissible amber Dashboard banner
(same visual pattern as the existing "N people waiting for approval" one) listing every past week
that has logged entries but isn't `Submitted`/`Approved` yet, distinguishing a `Rejected` week
("sent back") from one that was simply never submitted, linking to `/timesheet` to act on it.
- **Trigger:** Dashboard (`src/routes/index.tsx`) render, for the signed-in user.
- **Logic:** every distinct past `weekStart` (before `useThisWeekStart()`) present in `entries` where
  `timesheetForWeek(weekStart)?.status` is not `"Submitted"` or `"Approved"` — both values already
  available from `useWorkspace()`, no new query. A week with zero entries never needs this (nothing
  to submit), so the "has entries" condition already excludes genuine time off with no self-service
  changes needed.
- **Result:** a banner naming the week(s), e.g. "2 weeks are still waiting on you — week of Jul 28,
  week of Aug 4," linking straight to that week on the Timesheet page.
- **UX:** reuse the exact amber banner pattern already on the Dashboard for "N people waiting for
  approval" (`index.tsx`, `pendingCount`) — same visual language, same place, costs almost nothing
  to feel native.
- **Edge cases:** a `Rejected` week already has its own distinct "sent back, resubmit" messaging on
  the Timesheet page (`SubmissionPanel`) — worth a slightly different banner phrasing ("needs
  fixing" vs. "never submitted") rather than lumping both under one word. A brand-new user with no
  history shows nothing, correctly.
- **Complexity:** Low — pure client-side computation over `entries`/`timesheets`, both already
  loaded; no new query, no schema change.
- **Risks:** Low. Purely informational, changes no state. Worth making it dismissible per-session
  (not permanently silenced) so it doesn't turn into wallpaper for someone deliberately holding a
  week open pending a correction.

**M30. ✅ Fixed (narrowed).** No "you haven't logged anything today" nudge. Distinct from H19 (which is about
already-logged time never submitted) — this is about a day going by with nothing tracked at all.
- **Trigger:** it's a weekday, past some cutoff local to the person's own timezone (`profiles
  .timezone`, already stored and shown in Settings → Profile), and today has zero entries.
- **Logic:** `entries.filter(e => e.date === todayKey).length === 0`, gated on time-of-day computed
  against the user's stored timezone rather than the browser's.
- **Result:** a soft, dismissible line on the Dashboard — "Nothing logged today yet" — not a modal,
  not a toast that interrupts anything.
- **UX:** low-key by design; this is the one in the list most likely to be wrong some days, so it
  should never feel like it's accusing anyone of slacking off.
- **Edge cases:** this is the real caveat — weekends, public holidays, and approved leave all look
  identical to "forgot to log time" from the app's point of view, because the Time Off page is still
  mock data with no real calendar behind it (see the parity audit's M24). Without that, this either
  false-positives on every non-working day, or has to be scoped so narrowly (e.g. only Mon–Fri,
  only after the person's own history shows they normally log time by that hour) that it's only
  marginally useful. Per-user timezones also mean "past 3pm" isn't one global cutoff.
- **Complexity:** Low-Medium — the timezone-aware time check is the only fiddly part.
- **Risks:** Medium — the main risk here is annoyance/false positives, not correctness or data
  safety. Recommend shipping this only as an easily-dismissed, easy-to-permanently-turn-off nudge,
  not something that reappears every day regardless of feedback — and holding off entirely until/
  unless a real leave calendar exists (M24) to suppress it on days off.

Shipped narrower than originally scoped, per product decision: rather than a daily zero-entries
check, it fires at most once a week — Friday afternoon, only if the *entire* week has nothing
logged (`weekEntries.length === 0` in `src/routes/index.tsx`, reusing the week's entries already
computed for the stat cards), local to the person's own stored timezone via
`Intl.DateTimeFormat(..., { timeZone })` rather than a new date-library dependency. This avoids the
weekend/holiday/leave false-positive risk called out above almost entirely — a single day off no
longer trips it, only a week with truly nothing tracked does — at the cost of being less immediate
than a daily check.

**M31. ✅ Fixed.** Approvals had no bulk action — every timesheet was approved or sent back one at a
time. `ApprovalsPanel` (`src/routes/manage.tsx`) already tracks per-row busy state independently
(`busyIds`, a `Set` — see L26), so nothing stops two actions running concurrently, but there's no
way to act on more than one row from a single click.
- **Trigger:** a manager/admin on Manage → Approvals with several pending timesheets that all look
  routine.
- **Logic:** add row checkboxes and a "select all visible" control; "Approve selected" loops the
  *existing* `reviewTimesheet(id, "Approved")` RPC per selected id — no new backend, since it's
  already a single-timesheet-scoped call with self-review already blocked server-side. Each call
  needs its own try/catch so one failure doesn't abort the rest of the batch.
- **Result:** one confirmation dialog listing every person/week/hours about to be approved (not just
  a count), then N approvals fire; a single summary toast reports success vs. any that failed.
- **UX:** the per-row "expand to see entries" detail (`ApprovalEntries`) should stay available before
  selecting — bulk should mean "skip the repetitive clicking after you've already looked," never
  "skip looking."
- **Edge cases:** a timesheet whose status changed underneath the batch (another manager on a shared
  team approved it first, via Realtime) should skip cleanly with its own error, not fail the whole
  batch. Same for anything that trips a server-side check (self-review, in the unlikely case a
  manager's own row somehow got selected — it's already filtered out of `pendingApprovals`, but the
  batch loop should still treat a rejection from the RPC as a per-item failure, not a crash).
- **Complexity:** Medium — mostly UI (selection state, confirmation dialog listing every affected
  row) plus a loop with per-item error handling; no migration.
- **Risks:** Medium-High, and worth being explicit about: `review_timesheet()` has **no undo** —
  M19 in the original audit added a confirmation dialog specifically because approving is
  irreversible. A bulk "select all → approve" that's too easy to fire blindly cuts directly against
  that existing safeguard. Don't build this as a one-click "approve all" — the confirmation must
  name every person and week, not just say "12 timesheets," so a bulk click stays an informed
  decision rather than a rubber stamp.

Fixed exactly as specified: `ApprovalsPanel` now has per-row checkboxes plus a "select all"
toolbar, and "Approve selected" loops the existing `reviewTimesheet` call per id with its own
try/catch (a mid-batch failure — e.g. another manager approved the same row first — is reported as
a partial success, not a crash). The confirmation dialog lists every selected person, week, and
hours total before the batch fires, not just a count.

**M32. ✅ Fixed.** The Task field's default didn't use recency, even though Project's already did.
Both `TimerBar` (`time.tsx`) and `EntryFormDialog` already compute `orderByRecencyName(taskCategories,
entries)` to build the dropdown's "Recent" group — but the *default* selection on open falls back to
`taskCategories[0]` (first in creation/alphabetical order), not the most recently used one, even
though `recentProjects[0]` is exactly what the *project* field's default already does. Small,
concrete inconsistency: `time.tsx`'s two `useEffect`s (project vs. task default) literally use
different logic for what should be the same behavior.
- **Trigger:** opening TimerBar with no running entry, or opening the Add-entry dialog, for the
  first time in a session.
- **Logic:** change the task-default effect to `recentTasks[0]?.name ?? taskCategories[0]?.name ?? ""`
  — the exact pattern the project field already uses one function away.
- **Result:** one fewer click for the common case of mostly logging the same 1–2 task types.
- **UX:** invisible when it works — it's just the right thing pre-selected instead of the first
  alphabetical one.
- **Edge cases:** a brand-new workspace/user with no entries yet falls back to `taskCategories[0]`,
  identical to today's behavior. Someone who genuinely alternates tasks constantly gets no benefit,
  but no harm either — it's still just a default, always changeable before starting.
- **Complexity:** Very low — `recentTasks` already exists in both components; this changes which
  array feeds one `useEffect`.
- **Risks:** Negligible.

Fixed in both `TimerBar` and `EntryFormDialog`: the default-selection effect/value now reads
`recentTasks[0]?.name ?? taskCategories[0]?.name ?? ""`, the same fallback chain the project field
already used.

**M33. ✅ Fixed (expands on L30). "Copy previous day."** The parity audit's L30
already flagged the absence of a bulk-duplicate action; this pass adds the trigger/logic/edge-case
detail that pass didn't go into, since "quick duplicate previous entry" was explicitly one of the
categories asked about here.
- **Trigger:** a "Copy yesterday" button on `ListView`'s "Today" card (`time.tsx`) — visible whenever
  yesterday had entries and today doesn't already fully match them.
- **Logic:** clone each of yesterday's entries onto today via the existing `createEntry` call per
  entry (same function `repeatEntry`'s single-entry ↻ already uses), preserving project/task/
  description/duration but re-dating to today.
- **Result:** a full duplicate day-of-entries in one click, instead of recreating each one by hand or
  using ↻ Repeat (which starts a *live timer*, not a completed duplicate entry) one at a time.
- **UX:** should show what it's about to copy before committing (a short list, not a blind action),
  and respect `settings.allowManualEntry` the same way the existing Add-entry button already hides
  itself when manual entry is off.
- **Edge cases:** the DB's overlap `EXCLUDE` constraint and `overlapsExisting` client check both
  already guard against double-booking if today already has something in the same time slot —
  copying should surface that per-entry, not fail the whole batch, same reasoning as M31's bulk
  approve. A locked (submitted/approved) *today* should disable the button entirely, same as the
  existing manual-entry gating.
- **Complexity:** Low — no new mutation, just multiple calls to `createEntry`, which already exists.
- **Risks:** Low. Worst case is a duplicate entry someone has to delete — already a one-click action
  everywhere else in the app.

Fixed via a new `CopyYesterdayButton` on `ListView`'s Today card (`time.tsx`): shows a count-labeled
button, a confirmation dialog listing exactly what will be copied (project/description/duration per
entry), then loops `createEntry` per entry with its own try/catch — an overlap is skipped and
reported honestly rather than failing the whole batch. Hidden entirely when `allowManualEntry` is
off or yesterday has nothing to copy.

**L33. ✅ Fixed.** No lightweight "last week" recap. The Dashboard (`src/routes/index.tsx`) already
computes `weekTotal`/`dayTotals`/`topProjects` for the *current* week — there's no equivalent
glance-back at the week that just ended, which is exactly when someone's about to decide whether
their timesheet looks right before submitting it.
- **Trigger:** Dashboard render, Monday/Tuesday of a new week (i.e., last week has ended).
- **Logic:** the same aggregation `Dashboard` already does, just pointed at `addDays(weekStart, -7)`
  instead of `weekStart`, plus that week's `timesheetForWeek(...)?.status` for a one-word status.
- **Result:** a small card — "Last week: 38.5h across 4 projects · Submitted" — no email, no new
  infrastructure, purely a read of data already in context.
- **UX:** informational only, easy to ignore, no action required.
- **Edge cases:** first week of using the app has no "last week" — card simply doesn't render.
- **Complexity:** Low.
- **Risks:** Negligible.

Fixed as a small card on the Dashboard (`src/routes/index.tsx`), rendered whenever last week has
any entries — not gated to Monday/Tuesday specifically, since there's no real cost to showing it
any day and gating it added complexity without real benefit.

### 18. Considered and Rejected

- **Auto-stop or auto-submit a timer/timesheet.** Already explicitly rejected in the original audit
  (M18) for the same reason it stays rejected here: silently closing out a payroll-adjacent record
  isn't a call any automation should make unprompted, no matter how "obviously forgotten" a
  12-hour timer looks. The existing 4/8/12h warning + manager-facing Active Timers card is the right
  amount of automation for this — visibility, not action.
- **AI-suggested descriptions or auto-categorized tasks/projects based on time of day, past patterns,
  etc.** Explicitly out of scope per this audit's own instructions, and also just not needed — the
  existing recency-based "Recent" grouping already gets someone to their usual project/task in one
  click without any inference involved.
- **Idle/away detection with an auto-prompt.** Already rejected in the parity audit — needs a native
  desktop agent a browser tab structurally can't provide; the running-timer warning already covers
  the practical "did you forget this" case.
- **Keyboard shortcuts to switch between recent projects/tasks (e.g., number keys).** Marginal value
  for the added cognitive cost of memorizing bindings for an action (switching project) that's
  already one click via the "Recent" dropdown group — not worth the complexity for how rarely it'd
  actually save time over the mouse.
- **Automatic anomaly flagging (unusually short/long entries, e.g. under 1 minute or over 12
  hours).** The 12-hour case is already covered by the existing running-timer warning; a "this looks
  like a mis-click" flag for short entries would need a tuned threshold with no real basis (a
  genuine 30-second entry and a mis-click look identical to the app), and getting it wrong just adds
  friction to something that was already correct. Not worth building on a guess.
- **Recently-used projects/tasks surfaced when starting a timer.** Worth naming explicitly since it's
  one of the categories this audit was asked to look for: this is **already implemented** —
  `orderByRecency`/`orderByRecencyName` (`time-utils.ts`) already group both the TimerBar and
  Add-entry dialog's project/task pickers into "Recent" vs. the rest, based on real entry history.
  The only gap found in that area is M32 above (the task field's *default selection*, not the
  dropdown grouping, doesn't use that same recency data yet).

### 19. Already Automated — No Action Needed

Cross-checking every category this audit was asked to look for, so the list above isn't mistaken
for the full picture:

- **Recently used projects** — done (`orderByRecency`, TimerBar + Add-entry dialog).
- **Recently used tasks** — the dropdown grouping is done (`orderByRecencyName`); only the *default
  selection* isn't (M32).
- **Remembering previous selections** — effectively covered by the above: the project/task pickers
  default to what was most recently used, recomputed from real entries rather than a separate
  "remembered" setting that could drift from reality.
- **Forgotten timer detection** — done: self-facing 4/8/12h toast warnings (`TimerBar`) plus a
  manager/admin-facing Active Timers card flagging anything past 8h (`manage.tsx`).
- **Missing clock-out detection** — same mechanism as above; deliberately visibility-only, not
  auto-stop (see Rejected, above).
- **Overlapping time warnings** — done at both layers: a client-side pre-check (`overlapsExisting`)
  for an instant, friendly error, and a Postgres `EXCLUDE` constraint as the real backstop.
- **Automatic duration calculation** — done: every entry's minutes are computed from start/end time,
  never typed in directly, both for the live timer and manual entries.
- **Automatic overtime calculation** — done: Reports' employee view computes overtime against the
  workspace's weekly-hours target automatically, correctly excluding part-time staff (M15) rather
  than guessing.

### 20. Status Summary

- **Highest-value, lowest-risk automation in this pass (H19):** a Dashboard banner for unsubmitted
  past weeks. Pure client-side computation over data the app already has loaded, purely
  informational, and closes a real gap — right now nothing tells the person who actually needs to
  act (as opposed to their manager, who can already see this in Manage → Approvals) that a week is
  sitting unsubmitted.
- **Genuinely useful but needs care (M30, M31):** a "log time today" nudge is only as good as the
  app's ability to tell a real day off from forgetfulness, which it currently can't (no real leave
  calendar); bulk-approve is valuable for a manager clearing a routine queue but has to be built so
  a bulk click stays as informed as today's one-at-a-time click, given approving is irreversible.
- **Small, clearly worth doing (M32, M33, L33):** the task-field default is a one-line inconsistency
  fix; copy-previous-day and a last-week recap are both low-complexity, low-risk, and reuse
  functions/data that already exist.
- **Explicitly rejected, and why:** auto-stop/auto-submit (payroll risk, already decided against),
  AI-suggested content (out of scope, unnecessary given recency-sorting already works), idle
  detection (needs infrastructure a browser can't provide), keyboard shortcuts for project-switching
  (not enough time saved to justify), and anomaly-flagging short/long entries (no reliable basis to
  flag on).
- **Already automated, no new work needed:** recently-used projects, overlap detection, automatic
  duration/overtime calculation, and forgotten-timer visibility are all already real, not mocked —
  this pass's job was mostly finding the gaps *around* those, not rebuilding them.
