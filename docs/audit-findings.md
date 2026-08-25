# Ironbrij Time-Tracking Logic & Workflow Audit

Original audit performed 2026-08-11 against `src/lib/workspace/*`, `src/routes/*`, and `supabase/migrations/*`. Statuses below reflect what's shipped since.

**Framing note:** there is no discrete "clock in/out" or "Attendance" concept in this app. Everything is built on two primitives — a live **timer** (`start_time`/`end_time` on `time_entries`) and **manual entries** — plus a weekly **timesheet** submit/approve state machine layered on top.

---

## 1. Critical Issues — all fixed, except C4 (deliberately reverted 2026-08-19 — see below)

**C1. ✅ Fixed.** Managers/admins could approve their own submitted timesheet (`shares_team(x, x)` is trivially true for oneself). Fixed in `review_timesheet()` — self-review now raises an exception — and `pendingApprovals` filters out the viewer's own id.

**C2. ✅ Fixed.** A single click could leave the workspace with zero admins — `set_member_role()` had no last-admin guard. Fixed: demoting the last active admin is now blocked server-side, and the signed-in admin's own row shows a static badge instead of an editable role selector.

**C3. ✅ Fixed.** No DB constraint stopped multiple concurrent active timers per user (only in-memory client state guarded it). Fixed via `CREATE UNIQUE INDEX time_entries_one_running_per_user ON time_entries (user_id) WHERE end_time IS NULL`.

**C4. ⚠️ Reverted 2026-08-19 — this is now a deliberate product decision, not a regression.** No overlap validation on time entries. Was fixed via a Postgres `EXCLUDE` constraint (`btree_gist`, `tstzrange(start_time, end_time)`) plus a client-side pre-check for a friendlier error.

**Reverted:** `20260819000000_time_entries_allow_overlap.sql` drops the `EXCLUDE` constraint entirely, and the matching client-side pre-check was removed from `use-time-entries.ts` — commit `df512c1`, "Allow timer-less starts, overlapping entries, and add a searchable client filter," explicitly "matching Clockify." Flagged here because this directly contradicts this document's own "Fixed" marker on a *Critical* finding from five audit passes ago — anyone reading only the original section 1 table would believe overlaps are still blocked. They are not, as of 2026-08-19, on purpose. This also changed the failure shape H21's own fix (the atomic `stop_timer()` RPC, added 2026-08-25) was written against: the "later-day segment insert collides with an overlap" scenario H21 originally described can no longer happen, since overlaps are now allowed — H21's atomicity fix is still correct and still needed for other failure causes (network drop, tab close, a locked week), just no longer for that specific one.

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

*(Snapshot from this original 2026-08-11 pass — see the "Same-Day Implementation Pass (2026-08-25)"
section at the end of this document for the current picture. One correction: C4, "fixed" below, was
deliberately reverted 2026-08-19 — see C4's own entry above.)*

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

**H16. ✅ Fixed 2026-08-25. No entry-level ("Detailed") time report.** Reports (`src/routes/reports.tsx`) only
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

**Fixed:** built exactly as recommended — a third "Detailed" Reports tab (canManage-gated, same as
"By employee"), backed by a new `detailedEntriesForRange()` client query that reads `time_entries`
directly for a date range with no `user_id` filter, relying entirely on the table's own RLS
(self/admin/manager-shares-team) for scoping — no new RPC or policy work needed, exactly as this
finding predicted. Searchable (description/task), filterable by project/employee on top of the
existing team/client filters, paginated at 50 rows/page, with CSV export of the full filtered set
(not just the current page). Capped at 5000 rows server-side, same reasoning as H25's cap on the
personal entries fetch.

**H17. ✅ Fixed 2026-08-25. No cost/billing ($) report.** `member_employment.hourly_rate` (Schedule tab,
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

**Fixed:** took the recommended $-column option — a new `employee_billable_hours_range` RPC (same
shape and RLS-replication as `employee_hours_range`, filtered to `is_billable`) backs an "Amount"
column on Reports' "By employee" tab (billable hours × `hourly_rate`, in the workspace's own
`currency`, via a new `formatCurrency` helper), sortable, in the CSV export, and rolled into the
header's total line. **Not done**, as a deliberate scope call: subscription-hours-remaining was not
pulled into Reports — that figure is all-time (not date-ranged) in `ClientProfileDialog`/
`useClientBudgets`, a different shape than everything else on this otherwise date-ranged page, and
it's already visible one click away on the Clients tab. Pulling it in would mean a new all-time
per-client query duplicating existing logic for a "nice to have," not the core "$ figure to hand to
Xero" ask this finding was actually about.

**H18. ⚠️ Improved — the import tool now exists and is validated against a real export; the
actual cutover import hasn't been run yet.** There's no CSV/API import anywhere in the app itself —
every time entry starts empty at rollout.
**Why it matters:** "stop using Clockify" implies Ironbrij's historical hours (for reports,
client history, payroll reference) either migrate or are lost. This blocks the actual cutover more
than any in-app feature gap does.
**Recommended behavior:** doesn't need to be a permanent UI feature — a one-time admin-run import
script (Clockify's own CSV export → `time_entries` rows, mapped by email/project name) is enough,
run once during cutover and then deleted. Flagging it here so it's a deliberate decision, not a
surprise on migration day.
**Priority:** High (blocks cutover). **Complexity:** Low, as a one-off script — avoid building a
permanent importer UI for a need that only exists once.

**Built 2026-08-14:** `scripts/import-clockify-history.mjs` — a standalone, dependency-free
(`@supabase/supabase-js` only, already a project dependency) Node script matching exactly the
recommended shape above. Reads a Clockify "Detailed" CSV export, matches rows to `profiles` by
email and `projects` by name (an optional `--mapping` JSON file covers names that don't match
exactly; unmatched rows are reported and skipped, never guessed at or auto-created), splits any
entry crossing local midnight into per-day segments using the same invariant `splitByDay`
established for H8/M21 (timezone-aware, per matched user's own `profiles.timezone`), and defaults
to a dry run — `--commit` is required to actually write. Uses the service-role key (bypasses RLS,
same pattern `admin.functions.ts` already uses for privileged operations) since a bulk historical
backfill isn't a live user action; the database's own table-level constraints (the no-overlap
`EXCLUDE` constraint, the `duration_minutes` trigger) still apply regardless and are relied on
rather than reimplemented, with a per-row overlap rejection reported as a skip, not a crash.

**Validated against a real sample export** (Ironbrij's own Clockify "Detailed" report for
10–16 Aug 2026, 214 rows, provided by the product owner): the CSV parser, timezone conversion, and
midnight-crossing day-split were all exercised directly against it in offline mode (no database
credentials needed for this part). One real bug was found and fixed during that testing — the
dry-run summary's date-range line was calling `.toISOString()` on the raw UTC instant instead of
formatting it back through the target timezone, which misreported the range as one day earlier
than the file's actual dates (a display-only bug; the per-row `entry_date` used for the actual
insert was already correct, since it went through the timezone-aware path from the start). A
duration sanity check (script's own computed hours vs. Clockify's reported hours for the same
rows) came back at 201.20h computed vs. 201.23h reported — 0.03h of drift across 214 rows, pure
rounding noise, strong evidence the date/time parsing is correct end to end. The day-split logic
was separately verified against synthetic overnight and multi-day cases (23:00→03:00 next day;
22:00→06:30 two days later), both producing the expected per-day segments and minute totals.
**What's still open:** the actual cutover import — running this script with `--commit` against
Ironbrij's real Supabase project, using the full historical export (not just the one-week sample
used to validate the tool) — hasn't happened. That's why this is `⚠️ Improved`, not `✅ Fixed`:
the path now exists and is tested, but the historical data itself hasn't actually moved yet.

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

**M26. ✅ Fixed 2026-08-25. A time entry's billable status can't be overridden per entry.** `is_billable` is
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

**Fixed:** exactly as recommended — `WorkspaceEntry`/`updateEntry`/`createEntry` all carry a new
`billable` field, and `EntryFormDialog` has a "Billable" checkbox (hidden for a running entry, which
only supports correcting its start time). It defaults to the selected project's own setting and
keeps following it as the project changes, until the checkbox itself is touched once — then it's a
fixed override for that entry, same as an existing entry's stored value is from the moment the
dialog opens. `CopyYesterdayButton` (M33) now also carries over the *original* entry's billable
status when duplicating a day, rather than silently re-defaulting to the project's current setting.

**M27. ✅ Fixed 2026-08-25. No project-level budget or estimated-hours tracking.** Clients already have this
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

**Fixed:** added a nullable `budget_hours numeric(10,2)` column on `projects` (with a non-negative
`CHECK` from the start — `subscription_hours` didn't get one until L24 covered a different table,
added here proactively instead of waiting for a follow-up pass), a "Budget (hours)" input on
`ProjectFormDialog`, and a new `useProjectBudgets()` — structurally identical to the existing
`useClientBudgets()`, same all-time "rendered vs. budget" semantics and 90%-threshold near-limit
warning (the shared constant was renamed from `CLIENT_BUDGET_WARNING_THRESHOLD` to
`BUDGET_WARNING_THRESHOLD` since it's no longer client-only). Project cards now show "Over budget"
(red) / "Near budget" (amber) badges, distinct from the existing client-level "Client over budget"
badge — a project can be over its own cap while its client's retainer still has room, and vice
versa. **Not added to Reports**, consistent with the same scope call made for H17's client
subscription-hours-remaining: this is an all-time figure, not date-ranged, and would sit oddly in an
otherwise entirely date-ranged table.

**M28. ✅ Fixed 2026-08-25. Reports has no billable vs. non-billable breakdown.** The Dashboard computes a
personal "billable share" percentage (`src/routes/index.tsx`), but Reports — the actual
cross-team, exportable view — never splits hours by billable status at all, on either the project
or employee tab.
**Why it matters:** billable/non-billable is one of the first things anyone reviewing agency
utilization looks for; right now getting that number for anyone but yourself requires no tool at
all in this app.
**Recommended behavior:** an extra column (or stacked-bar split) on both Reports tabs using the
`is_billable` flag already on every entry/project.
**Priority:** Medium. **Complexity:** Low.

**Fixed:** added a new `project_billable_hours_range` RPC (company-wide visibility, same shape as
`project_hours_range`, summed from `time_entries.is_billable` per row rather than
`projects.is_billable`, since M26 now lets any entry override the project's default) and reused the
employee-side billable data already fetched for H17. Both Reports tabs now have a "Billable" column
(hours + %), sortable, in both CSV exports.

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

**L30. ✅ Fixed (superseded by M33 below).** No "copy previous day" or duplicate-entry shortcut.
Repeating a whole day's set of entries (common for people whose Tuesday looks like their Monday)
currently means re-creating each entry by hand or using the single-entry ↻ Repeat action
(`EntryList` in `time.tsx`) one at a time.
**Recommended behavior:** a "Copy yesterday" action on `ListView` that clones the prior day's
entries onto today via `createEntry`, same pattern `repeatEntry` already uses per-entry.
**Priority:** Low. **Complexity:** Low.

*Status correction (Final Product Review pass, 2026-08-14): this finding's own marker was never
updated when the Smart Automation audit built exactly this feature under M33 — verified live in
`src/routes/time.tsx` (`CopyYesterdayButton`, line 586 at time of writing). Marking fixed here
rather than leaving it permanently open.*

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

---

## Database & Data Integrity Audit

Performed 2026-08-14 against the full `supabase/migrations/*` history (all 35 files, in
chronological order, read in full — not sampled) plus the client code paths that write to these
tables: `src/lib/workspace/use-time-entries.ts`, `use-timesheets.ts`, `use-tags.ts`,
`use-members.ts`, and `src/lib/admin.functions.ts`. **No schema was created or modified during this
pass** — every finding below is a recommendation, not a change.

This is a different lens than the three passes above: not "does the workflow make sense" (the
first audit), not "is it feature-complete against Clockify" (the parity audit), not "what's
repetitive" (the automation audit) — specifically, "if a client bug, a direct API call, a race
between two sessions, or a raw SQL statement bypassed the UI entirely, what could go silently
wrong with the actual data." Numbering continues from the passes above; new findings start
`⏳ Open`.

### 21. Schema Overview (for reference)

Core tables and their write paths, as actually implemented (not as documented elsewhere) — this is
the map the findings below refer back to:

| Table | Owner FK | Delete behavior | Write path |
|---|---|---|---|
| `profiles` | — (PK, no FK to `auth.users`) | `profiles_delete_admin` RLS policy + direct `GRANT DELETE` to `authenticated` | Direct table access (RLS-gated); role changes only via `set_member_role()` |
| `time_entries` | `user_id → profiles(id) ON DELETE CASCADE` | cascades from profile deletion | Direct table access (RLS-gated: self/admin/manager-shares-team, `week_is_locked()`, `description_required()`, `manual_entry_allowed()`) |
| `timesheets` | `user_id → profiles(id) ON DELETE CASCADE`, `reviewed_by → profiles(id)` **(no `ON DELETE` clause — defaults to `NO ACTION`)** | cascades from profile deletion; blocked if `reviewed_by` points at the profile being deleted | No direct INSERT/UPDATE/DELETE grant — only via `submit_timesheet()` / `review_timesheet()` |
| `team_members`, `project_members` | `user_id → profiles(id) ON DELETE CASCADE` | cascades from profile deletion | Direct table access (`can_manage()`-gated); logged via `log_team_membership_change()` trigger (team_members only) |
| `member_employment` | `user_id → profiles(id) ON DELETE CASCADE` | cascades from profile deletion | Direct table access, admin/manager-only |
| `activity_log` | `actor_id`/`target_user_id → profiles(id) ON DELETE SET NULL` | survives profile deletion (nulled) | Append-only via `SECURITY DEFINER` functions/triggers — no grant to `authenticated` at all |

### 22. Critical Integrity Issues

**C6. ✅ Fixed.**
- **Database object:** `time_entries.duration_minutes` (`integer`, nullable; introduced in
  `20260804000910_5a7605fb-...sql`).
- **Problem:** `duration_minutes` has no server-side relationship to `start_time`/`end_time` at
  all — no `CHECK` constraint, no trigger, no generated-column derivation. It is a plain
  client-supplied integer.
- **Current behavior:** every write path (`startTimer`/`stopTimer`/`createEntry`/`updateEntry` in
  `use-time-entries.ts`) computes `duration_minutes` in JavaScript
  (`Math.round((end.getTime() - start.getTime()) / 60000)`) and sends it as a separate field
  alongside `start_time`/`end_time` — the database never recomputes or verifies it. Every one of
  this app's own server-side business-rule backstops (`week_is_locked()`, `description_required()`,
  `manual_entry_allowed()`, the `time_entries_not_far_future` and
  `member_employment_hourly_rate_check` CHECKs, the no-overlap `EXCLUDE` constraint) has exactly
  this shape — a client-side check *and* a database one — except this single field, which is the
  one every hours-based feature in the app actually sums.
- **Impact:** a client bug, a browser extension, or literally opening devtools and editing the
  network request before it's sent can record `duration_minutes = 480` for a 5-minute span (or
  a negative number, or `NULL` on a completed entry, silently contributing zero). That fabricated
  number flows unverified into `project_hours()`, `project_hours_range()`, `employee_hours_range()`,
  `employee_client_hours_range()` — i.e., Reports, overtime calculations (`weeklyHours` comparison),
  and the client subscription-hours budget tracking just added — with nothing anywhere ever
  cross-checking it against the timestamps that supposedly produced it. For a payroll-adjacent,
  client-billing-adjacent system, this is the single most consequential value in the schema, and
  it's the one exception to this codebase's otherwise consistent "client check + DB backstop"
  discipline.
- **Severity:** Critical.
- **Recommended solution:** a `CHECK` constraint can't reference `end_time - start_time` in minutes
  cleanly across a nullable `end_time` (a running entry has no duration yet), so the right shape is
  either (a) a `CHECK (end_time IS NULL OR duration_minutes = CEIL(EXTRACT(EPOCH FROM (end_time -
  start_time)) / 60))` if exact-match is desired (risk: any legitimate rounding difference between
  the client's `Math.round` and Postgres's arithmetic would then hard-reject good writes — needs
  testing against the actual client rounding before adopting), or (b) a looser sanity bound (e.g.
  `duration_minutes >= 0 AND duration_minutes <= EXTRACT(EPOCH FROM (end_time - start_time)) / 60 +
  1` allowing a minute of slack) plus a `BEFORE INSERT OR UPDATE` trigger that recomputes
  `duration_minutes` from the timestamps server-side rather than trusting the client value at all —
  the latter is more robust and removes an entire class of drift rather than just bounding it.
  Either way, this needs the same "check existing data for violations first" caution as the
  overlap/one-running-timer migrations already document.

Fixed in `supabase/migrations/20260814010000_time_entries_server_side_duration.sql`, via the
recompute-via-trigger option rather than a hard exact-match `CHECK` (the safer of the two, per the
reasoning above — it can never reject an existing row). A new `BEFORE INSERT OR UPDATE` trigger,
`compute_time_entry_duration()`, now derives `duration_minutes` from `start_time`/`end_time`
server-side on every write — `NULL` while `end_time IS NULL` (still running), otherwise
`GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60))`, mirroring the client's own
`Math.max(1, minutes)` floor exactly. Whatever `duration_minutes` a client (or a direct API call)
sends is now simply overwritten with the server-computed value — the drift this finding described
is no longer possible, not just bounded. A `time_entries_duration_non_negative` CHECK
(`duration_minutes IS NULL OR duration_minutes >= 0`) was added alongside it as a defense-in-depth
backstop, safe to add with no data check needed since every existing row already satisfies it.

**C7. ✅ Fixed.**
- **Database object:** `public.profiles` — the `GRANT ... DELETE ON public.profiles TO
  authenticated` and `profiles_delete_admin` RLS policy (both from
  `20260804000910_5a7605fb-...sql`, never revisited since).
- **Problem:** any admin can issue a direct `DELETE FROM profiles WHERE id = ...` (e.g.
  `supabase.from("profiles").delete().eq("id", x)` from the browser console, or any future code
  path that doesn't know better) — nothing in the app's own UI does this today, but RLS explicitly
  permits it.
- **Current behavior:** `time_entries.user_id`, `timesheets.user_id`, `team_members.user_id`,
  `project_members.user_id`, and `member_employment.user_id` are all `REFERENCES
  profiles(id) ON DELETE CASCADE`. Deleting a `profiles` row therefore permanently deletes every
  time entry, timesheet (including **approved, locked** ones — cascade deletes are enforced by
  Postgres directly and do not go through `time_entries`'/`timesheets`' own RLS policies, so
  `week_is_locked()`'s admin-only-override-on-approved-weeks protection is simply bypassed, not
  overridden), team membership, project assignment, and employment/rate record that person ever
  had. This directly contradicts what Settings → Users' own remove-member dialog tells an admin:
  *"Their past time entries, timesheets, and reports stay exactly as they are; nothing historical
  is deleted."* That promise is kept by the app's actual "remove user" flow
  (`removeUserAccess` in `admin.functions.ts`, which deliberately soft-deactivates via
  `is_active = false` and only ever deletes the `auth.users` row and `team_members` rows — its own
  comment explains this exact reasoning) — but the schema itself doesn't enforce or require that
  safer path; it just happens to be the only one the UI currently uses. One partial, accidental
  mitigation: `timesheets.reviewed_by → profiles(id)` has **no `ON DELETE` clause** (defaults to
  `NO ACTION`), so deleting a profile that has ever reviewed *someone else's* timesheet fails
  outright with a raw foreign-key-violation error instead of succeeding — but this only protects
  managers/admins who've reviewed at least once, not the plain Members who make up most of a
  workforce and whose time-tracking history is exactly what this app exists to protect. There is
  also no trigger logging a `profiles` deletion to `activity_log` itself — the only trace left
  behind is a flood of `time_entry_edited`/`time_entry_deleted` rows from the existing
  `log_time_entry_edit_by_other` trigger (which does fire per-row during the cascade, since triggers
  — unlike RLS — do run for cascade-induced deletes), with no single record of the deletion event
  or the fact a `timesheets` row (which has no such trigger at all) ever existed.
- **Impact:** irreversible, un-confirmed (no "type the name to confirm" gate the way Projects'
  delete already has), essentially un-audited destruction of exactly the kind of record — logged
  hours, approved timesheets — this application's entire purpose is to preserve, reachable by
  anyone holding the admin role with a single API call that the schema itself invites rather than
  merely fails to prevent.
- **Severity:** Critical.
- **Recommended solution:** revoke the `DELETE` grant on `public.profiles` from `authenticated`
  (or drop `profiles_delete_admin` and don't replace it) — the app already has a working, safer
  path (`is_active = false` via `removeUserAccess`) that achieves everything the UI needs without
  this blast radius, so removing the capability rather than trying to safely constrain it (e.g.
  with a confirmation requirement that RLS can't express anyway) is the lower-risk fix. If there's
  ever a real "purge this person's data" requirement (e.g. a legal deletion request), that should
  be its own explicit, logged, `SECURITY DEFINER` function — the same pattern every other
  irreversible action in this schema already follows — not a bare table grant.

Fixed in `supabase/migrations/20260814000000_revoke_profiles_delete.sql`, exactly as
recommended: `profiles_delete_admin` is dropped and `DELETE` is revoked from `authenticated`
entirely. `service_role` (which `removeUserAccess()` in `admin.functions.ts` actually runs as) is
untouched — it already had `GRANT ALL` and needs nothing from this grant, so the app's real
remove-user flow is unaffected. There is no longer any path, through the app or through a direct
API call by an authenticated user, to delete a `profiles` row and cascade away someone's
`time_entries`/`timesheets`/`team_members`/`project_members`/`member_employment`.

### 23. High-Priority Issues

**H20. ✅ Fixed 2026-08-14.**
- **Database object:** `public.submit_timesheet(_week_start date)`
  (originally `20260804110000_timesheet_approvals.sql`, most recently redefined in
  `20260812070000_require_entries_to_submit.sql`).
- **Problem:** the function's own "don't lock a week with a timer still running in it" check
  (`_has_running`) and the subsequent `INSERT ... ON CONFLICT DO UPDATE` that actually submits
  (and, since `20260811040000_lock_on_submit.sql`, locks) the week are two separate statements
  with no explicit locking between them.
- **Current behavior:** under Postgres's default `READ COMMITTED` isolation, each statement inside
  the function sees a fresh snapshot — there is no `SELECT ... FOR UPDATE`, advisory lock, or
  `SERIALIZABLE` transaction wrapping the check-then-act sequence. A `startTimer` INSERT from a
  second tab/device for the same user can commit in the narrow window between this function's
  `_has_running` check returning false and its own `INSERT INTO timesheets` committing.
- **Impact:** this reintroduces, via a race rather than a missing check, precisely the bug
  `20260811040000_lock_on_submit.sql` was written to close ("locking on submit creates a trap... you
  can't submit a week with a timer still going," per that migration's own comment) — a running
  timer ends up trapped inside a week that's now locked (`week_is_locked()` treats `'submitted'` the
  same as `'approved'`), and `stopTimer`'s own `UPDATE ... WHERE id = entryId` would then silently
  affect zero rows (the established "locked week silently excludes the row from RLS's `USING`
  clause" behavior this codebase already works around elsewhere via `.select("id")` + a length
  check) — surfacing to the person as their stop-timer call failing with the generic locked-week
  message, with no obvious path to resolve it themselves.
- **Severity:** High — narrow window (requires near-simultaneous action from the same person across
  two sessions), but the failure mode is exactly the one this schema already went out of its way to
  prevent, and the person affected has no self-service recovery.
- **Recommended solution:** wrap the check-and-submit sequence in `submit_timesheet()` with
  `PERFORM 1 FROM time_entries WHERE user_id = auth.uid() AND entry_date >= _week_start AND
  entry_date < _week_start + 7 FOR UPDATE` (row-locking the candidate entries for the duration of
  the function) so a concurrent `startTimer` INSERT either commits first (and gets caught by the
  existence check) or blocks until this transaction finishes — or equivalently, take a
  transaction-scoped `pg_advisory_xact_lock(hashtext(auth.uid()::text))` at the top of the function
  to fully serialize a single user's own submit/start-timer operations against each other.

**Fixed in `20260814030000_atomic_submit_timesheet_lock.sql`:** used the second alternative above,
but keyed on the user's own `profiles` row rather than an advisory-lock hash (equivalent
serialization, no new lock-key scheme to introduce). `submit_timesheet()` now takes
`SELECT ... FOR UPDATE` on `profiles WHERE id = auth.uid()` as its first statement, held for the
rest of the call; a new `BEFORE INSERT` trigger on `time_entries`
(`lock_user_before_timer_start_trg`, firing only when `NEW.end_time IS NULL`, i.e. a timer actually
starting) takes the same lock on `NEW.user_id` before RLS's `WITH CHECK` (and therefore
`week_is_locked()`) evaluates the row. Whichever transaction reaches the lock first now blocks the
other until it commits, so the two can no longer interleave — the "start timer" side either sees the
week already locked and gets rejected normally, or completes and commits before `submit_timesheet()`
ever runs its `_has_running` check.

**H21. ✅ Fixed 2026-08-25.**
- **Database object:** no single database object — this is about the *absence* of one: `stopTimer`'s
  multi-day split (`use-time-entries.ts`) is implemented as two separate, sequential client-side
  Supabase calls (`INSERT` of later-day segments, then `UPDATE` of the original row) with no
  wrapping transaction or `SECURITY DEFINER` RPC tying them together.
- **Problem:** the split isn't atomic. The code comment in `use-time-entries.ts` already
  acknowledges the ordering was chosen deliberately ("insert later-day segments *before* touching
  the original row" so a failure leaves the original "still running and visible, not silently
  missing time") — which correctly protects against losing the *original* row, but doesn't protect
  against losing the *later* segments.
- **Current behavior:** if a shift spans three days and the insert for day 2 succeeds but the
  insert for day 3 fails (or the browser tab closes, or the network drops) partway through the
  `for (const seg of laterSegments)` loop, `stopTimer` throws — but whatever segments already
  committed stay committed (each `insert()` is its own independent statement, not part of one
  transaction), and the function never reaches the final `UPDATE` on the original row, which is
  left permanently `running`. The person sees a thrown error and (per the existing code) the
  original entry is still shown as running — so the immediate symptom is visible, not silent.
  The more concerning direction: if all the later-day inserts succeed but the final `UPDATE` on the
  original row fails (e.g. a network drop after the inserts but before the update reaches the
  server, or the tab closing in that gap), the later days are correctly recorded **but the original
  entry keeps running indefinitely** with no automatic reconciliation — and because
  `time_entries_one_running_per_user` then blocks a fresh timer start, the person is stuck until
  they notice and manually stop or edit the stale entry.
- **Impact:** a partial multi-day split can leave the data in a state no single existing safeguard
  fully detects — not silent data corruption (the "stuck running" case is at least visible on the
  Time page), but a real risk of a multi-day shift ending up split across two inconsistent states
  with no automated recovery path, for exactly the "working across midnight" scenario this schema
  already put real effort into handling correctly (H8 in the original audit).
- **Severity:** High — data-loss risk is bounded (nothing is silently double-counted or
  silently dropped without *some* visible symptom), but the recovery burden falls entirely on the
  affected person noticing and fixing it by hand.
- **Recommended solution:** move the whole split-and-close operation into a single `SECURITY
  DEFINER` RPC (mirroring the shape `submit_timesheet`/`review_timesheet` already use) that inserts
  every segment and updates the original row inside one Postgres transaction — either all of it
  commits, or none of it does, and the client goes back to a single round trip instead of an
  N+1 sequence it can't make atomic on its own.

**Fixed:** exactly as recommended — a new `stop_timer(_entry_id, _description, _segments)`
`SECURITY DEFINER` RPC (`20260825010000_atomic_stop_timer.sql`) does the whole close-and-split in
one transaction; a `RAISE EXCEPTION` at any point rolls back everything the call already did. Takes
a row lock (`FOR UPDATE`) on the entry so two concurrent stop attempts serialize instead of racing —
a robustness win the old client-side implementation never had. Day-splitting itself is still
computed client-side (`splitByDay`, unchanged, browser-local time) and passed in as ordered JSON
segments; only the writes moved server-side. Since `SECURITY DEFINER` bypasses RLS, every rule the
bypassed policies would have enforced is replicated explicitly inside the function:
`is_active_user` (H15), `week_is_locked` with the same admin override, `description_required`, and
`manual_entry_allowed` (preserved exactly as it already behaved — it already applied to a later-day
segment insert since its `end_time` is set at insert time — not reconsidered as part of this fix).
Note: the specific *overlap-collision* failure mode this finding originally described can no longer
happen, since C4's overlap constraint was separately removed on 2026-08-19 (see C4 above) — this fix
still matters for every other partial-failure cause (network drop, tab close, a locked week).
**Not independently verified against a live database** — this is the most structurally complex
migration added this session (a loop, `WITH ORDINALITY`, row locking), more so than the plain-SQL
functions elsewhere in this pass; flagged for a real syntax/behavior check before relying on it, per
H23's standing recommendation for every migration in this repo.

### 24. Medium-Priority Issues

**M34. ✅ Fixed 2026-08-25.**
- **Database object:** `timesheets.week_start` (date, `20260804110000_timesheet_approvals.sql`) and
  `submit_timesheet(_week_start date)`.
- **Problem:** nothing constrains `week_start` to actually be a Monday — the app's own notion of
  "week" (`startOfWeek()` in `time-utils.ts`, used everywhere the UI computes a week boundary).
  `submit_timesheet()` uses whatever date it's given verbatim, with no `date_trunc('week', ...)`
  normalization or `CHECK` constraint.
- **Current behavior:** every UI call path always passes an already-Monday-aligned date, so this
  never happens through normal use. A direct RPC call
  (`supabase.rpc("submit_timesheet", { _week_start: "2026-08-13" })`, a Wednesday) would create a
  `timesheets` row keyed to that arbitrary date, and `week_is_locked()`'s `_entry_date >= week_start
  AND _entry_date < week_start + 7` arithmetic would then lock a 7-day window that doesn't align
  with any Monday-start week the Timesheet/Grid/Reports UI ever renders — straddling parts of two
  different UI-displayed weeks.
- **Impact:** low likelihood (requires bypassing the UI entirely), but if it happened, the
  resulting confusion would be hard to diagnose — entries would appear locked or unlocked in a
  pattern that doesn't match any week boundary a manager or the affected person can see on screen.
- **Severity:** Medium.
- **Recommended solution:** either a `CHECK (extract(dow from week_start) = 1)` constraint on
  `timesheets` (Postgres `dow` numbering: Monday = 1), or normalize inside `submit_timesheet()`
  itself via `_week_start := date_trunc('week', _week_start)::date` before using it — the latter is
  more forgiving (silently corrects rather than rejects) and matches how the rest of this schema
  prefers to guide behavior over hard-failing where it reasonably can.

**Fixed:** took the recommended normalization option — `submit_timesheet()` now runs
`_week_start := date_trunc('week', _week_start)::date;` as its first statement
(`20260825040000_normalize_submit_timesheet_week_start.sql`). No `CHECK` constraint added alongside
it: `authenticated` has no INSERT/UPDATE grant on `public.timesheets` at all, so `submit_timesheet()`
is the *only* write path — normalizing there closes the gap completely, not just partially, making a
table-level constraint genuinely redundant rather than defense-in-depth.

**M35. ✅ Fixed 2026-08-25.**
- **Database object:** `time_entries.tag_ids` (`uuid[]`, `20260804000910_5a7605fb-...sql`).
- **Problem:** `tag_ids` is a plain array column, not a real relationship — Postgres can't put a
  foreign key on individual array elements, so nothing enforces that every UUID inside it still
  refers to an existing `tags` row.
- **Current behavior:** `deleteTag` (`use-tags.ts`) only ever runs `DELETE FROM tags WHERE id =
  id` — confirmed by reading the function directly. `project_tags` cleans up correctly via its own
  `ON DELETE CASCADE`, but `time_entries.tag_ids` is never touched. Every historical entry that
  carried the deleted tag keeps that now-dangling UUID in its array, permanently.
- **Impact:** not user-visible today — `tag_usage()` joins `FROM tags`, so a dangling id simply
  never shows up anywhere and doesn't corrupt any displayed count — but it's a slow, permanent
  accumulation of orphaned data with no cleanup mechanism and no admin tooling that can even see it
  to clean it up, since every UI path to tags goes through the current `tags` table, never the raw
  array contents.
- **Severity:** Medium (data cleanliness / technical debt, not a correctness-of-output bug today).
- **Recommended solution:** either accept this as a permanent, harmless artifact (arrays of a
  handful of short UUIDs per row cost very little), or have `deleteTag` remove the id from every
  entry's `tag_ids` first — `UPDATE time_entries SET tag_ids = array_remove(tag_ids, _tag_id)
  WHERE _tag_id = ANY(tag_ids)` — wrapped into the same `SECURITY DEFINER` treatment as the tag
  delete itself, so it's atomic with the `tags` row deletion rather than a second client-side call
  that could itself fail independently.

**Fixed:** took the recommended cleanup option — a new `delete_tag(_tag_id)` `SECURITY DEFINER` RPC
(`20260825050000_delete_tag_cleans_up_entries.sql`) strips the id from every entry's `tag_ids` first
(`UPDATE ... SET tag_ids = array_remove(tag_ids, _tag_id) WHERE _tag_id = ANY(tag_ids)`), then
deletes the tag row, in one call — atomic with the delete, exactly as recommended. A `can_manage()`
check up front replicates `tags_write_manage`'s own RLS policy exactly (and already folds in
`is_active_user` per H15), since this has to bypass RLS to reach every user's `time_entries` rows
workspace-wide, not just rows the caller could update directly under `shares_team()` scoping.
`deleteTag()` in `use-tags.ts` now calls the RPC instead of a bare `DELETE`.

**M36. ✅ Fixed 2026-08-25.**
- **Database object:** `time_entries.entry_date` (date) vs. `time_entries.start_time` (timestamptz),
  both `20260804000910_5a7605fb-...sql`.
- **Problem:** nothing in the database enforces that `entry_date` actually corresponds to the local
  calendar day `start_time` falls on. They're independently supplied, independently trusted values.
- **Current behavior:** the client always computes `entry_date` from `start_time` using
  `toDateKey()` (local time, per the browser), consistently — but "local" here depends on
  `profiles.timezone`, a mutable setting a person can change in Settings → Profile at any time.
  Every server-side business rule that reasons about "which week is this entry in" —
  `week_is_locked()`, `submit_timesheet()`'s entry/running-timer existence checks,
  `flag_approved_week_modified()`, and every Reports RPC — filters by `entry_date` directly, never
  by `start_time` interpreted through a timezone. There's no CHECK relating the two, and no
  mechanism reconciling `entry_date` on old rows if someone's `timezone` changes after those
  entries were created.
- **Impact:** low-frequency but real for a distributed VA-staffing team spanning multiple
  timezones (`Australia/Sydney`, `Asia/Manila`, etc. are literally in the app's own `timezones`
  list) — a genuinely mistimed or malformed `entry_date` (from a client bug, a direct API call, or
  just a person changing their timezone setting after logging time near a day boundary) has no
  database-level way to be caught, and would silently affect which week an entry counts toward for
  locking/submission/reporting purposes without matching what `start_time` would actually imply.
- **Severity:** Medium.
- **Recommended solution:** a `CHECK` constraint can't easily express "matches this person's
  timezone" (that requires a join, which CHECK constraints can't do). The more tractable fix is a
  `BEFORE INSERT OR UPDATE` trigger that derives `entry_date` server-side from `start_time` plus a
  timezone looked up from `profiles` at write time (`(start_time AT TIME ZONE (SELECT timezone FROM
  profiles WHERE id = NEW.user_id))::date`), rather than trusting the client-supplied value —
  removing the possibility of drift entirely instead of trying to detect it after the fact.

**Fixed:** took the recommended trigger option — a new `BEFORE INSERT OR UPDATE` trigger
(`20260825060000_derive_entry_date_from_timezone.sql`) recomputes `entry_date` server-side from
`start_time` interpreted through the entry owner's *current* `profiles.timezone`, on every write,
same pattern C6/H20 already established for `duration_minutes`. Plain `SECURITY INVOKER` — no
elevated privilege needed, since `profiles_select_all` already lets any active authenticated user
read any profile's timezone. **Known accepted edge case, documented in the migration, not fixed
here:** H8/M21's multi-day split still splits at *browser*-local midnight, not the entry owner's
`profiles.timezone` — if those genuinely differ, a split entry's segments can straddle this
trigger's day boundary differently than the browser-time split intended. Making the split itself
timezone-aware is a separate, larger change this finding didn't ask for.

### 25. Low-Priority Issues

**L34. ✅ Fixed 2026-08-25.**
- **Database object:** `public.profiles` — specifically the client-side bootstrap insert in
  `use-members.ts` that creates a person's own profile row on first sign-in (`supabase.from
  ("profiles").insert({ id: uid, ... })`), not a schema object itself.
- **Problem:** that insert has no `.catch()` — it's a bare `.then(() => qc.invalidateQueries(...))`
  with no error handler.
- **Current behavior:** under normal conditions this succeeds and is idempotent-by-construction
  (guarded by `profilesQ.data.some((p) => p.id === uid)` first). But if it fails — a transient
  network error, or a genuine race between two tabs open simultaneously on a brand-new account's
  very first load both attempting the insert (the second would hit `profiles`' own primary key and
  fail with a `23505` unique violation, which is actually the *correct*, safe outcome for the
  table, but the promise rejection from it is silently swallowed) — nothing surfaces that failure
  to the person. They're left on whatever loading/empty state renders for "no profile exists yet,"
  indistinguishable from the app still loading, with no retry affordance.
  This is exactly the class of gap H13 in the original QA audit fixed everywhere else in this app
  (a global `QueryCache({ onError })` toast plus a core-shell loading/error gate) — this one
  specific mutation predates that fix and wasn't swept up by it, since it isn't a `useQuery`.
- **Impact:** low frequency (only matters on a brand-new account's very first load), not a data
  integrity issue in itself (the PK correctly prevents a duplicate profile), but a real "silently
  stuck new user with no error and no recourse" gap.
- **Severity:** Low.
- **Recommended solution:** add a `.catch()` that surfaces a toast (the same `sonner` pattern used
  everywhere else in this codebase) — no schema change needed, this is a client-code gap that
  happens to matter for data-flow completeness around user creation, which is why it's included
  here rather than in the automation/parity passes above.

**Fixed:** took the recommended option, with one adjustment noted below. `use-members.ts`'s bootstrap
effect now checks the resolved `{ error }` (Supabase's query builder resolves rather than rejects on
a Postgres/API error, so the old bare `.then()` was silently ignoring `error` even when it *did*
fire) and toasts "Couldn't set up your account" for anything other than a `23505` unique violation
(the harmless race case — Realtime's own `profiles` subscription already picks up the other tab's
successful insert and invalidates). A second `.then()` callback (not a chained `.catch()` — the
Supabase builder is a `PromiseLike`, not a real `Promise`, so `.catch()` doesn't type-check on it)
covers a genuine network-level rejection with the same toast. This one hook file now imports
`sonner` directly, unlike every other `workspace/*.ts` data hook (which leave toasting to the
calling component) — a deliberate exception: this is a background bootstrap effect with no caller
awaiting it, so there's no other way for this specific failure to reach the person at all.

### 26. Migration Considerations

The two Critical findings (C6, C7) were applied as new, additive migrations on 2026-08-14, in the
order originally recommended:

1. **C7 (revoke `profiles` DELETE)** — applied first as planned: the lowest-risk, highest-value fix,
   a pure `REVOKE`/`DROP POLICY` that removes a capability nothing in the app used, and can't break
   any existing working flow (`removeUserAccess` runs as `service_role`, untouched by this grant).
2. **C6 (`duration_minutes`)** — applied via the recompute-via-trigger option specifically because
   it needed the same "don't risk rejecting existing data" discipline every prior constraint
   migration in this schema documents (`time_entries_one_running_per_user`,
   `time_entries_no_overlap`); a trigger that always derives the correct value, rather than a hard
   `CHECK` that could reject a legitimate historical row over an off-by-one-minute rounding
   difference, was chosen for exactly that reason.

These were written as new migration files (`20260814000000_revoke_profiles_delete.sql`,
`20260814010000_time_entries_server_side_duration.sql`) rather than applied directly against the
live project — this environment has no linked Supabase CLI session or service-role credential to
run them with, consistent with how every other migration in this repo's history was authored (as a
file, applied through whatever pipeline actually deploys this project). They still need to actually
reach the database before either fix takes effect.

The remaining findings (H20, H21, M34–M36, L34) are still open recommendations only — not applied.
If picked up later, in rough dependency/risk order:

1. **H20/H21** are both about tightening existing `SECURITY DEFINER` functions/client flows, not
   new constraints — no data-backfill risk, just logic changes, but each needs its own testing
   against concurrent-session scenarios that are inherently awkward to write integration tests for.
2. **M34/M36** are both "normalize or derive server-side instead of trusting the client" fixes in
   the same spirit as C6 — worth bundling with that kind of work rather than doing separately,
   since they touch the same `entry_date`/`week_start` surface.
3. **M35/L34** are independent, low-risk, and can be picked up any time without coordination.

### Files/migrations inspected this pass

All 35 files under `supabase/migrations/` in chronological order, read in full:
`20260804000910_5a7605fb-...` and `20260804000949_22c80da0-...` (base schema) through
`20260812090000_enable_realtime_workspace_tables.sql` (most recent) — including the timesheet
state machine (`20260804110000`, `20260811040000`, `20260812070000`, `20260812080000`), every
`time_entries` RLS iteration (`20260804000910` → `20260812060000`), the overlap/one-timer
constraints (`20260811020000`, `20260811030000`), and the self-review/last-admin/is_active guards
(`20260805080000`, `20260811000000`, `20260811010000`, `20260812060000`). Also read in full:
`src/lib/workspace/use-time-entries.ts`, `use-timesheets.ts`, `use-tags.ts`, `use-members.ts`, and
`src/lib/admin.functions.ts`, to confirm actual client write behavior against what the schema
permits, rather than assuming from the migrations alone.

---

## Manager & Admin Workflow Audit

Performed 2026-08-14 from the perspective of an Ironbrij manager or admin doing the job day to
day, not from a correctness or feature-completeness lens — specifically: where does a routine
management task take more clicks, more page-switches, or more manual re-entry than the data
already sitting in the app should require. Inspected `src/routes/manage.tsx` (Approvals, Activity,
Schedule, Entries), `src/routes/reports.tsx`, `src/routes/settings.tsx` (Users, Admin tabs),
`src/routes/teams.tsx`, and `src/components/app-shell.tsx` (nav badges). No code was changed —
this is a review pass, matching this audit's own instructions. Numbering continues from the
Database & Data Integrity audit above; all findings start `⏳ Open`.

**Scope note, stated up front rather than repeated per-finding:** there is still no structured
attendance/schedule data model — `member_employment.weekly_schedule` is free text, not a
start/end time per day — so "identify late attendance" genuinely isn't answerable today, and
building the schedule data required to answer it would be exactly the "turn this into an HR
platform" this audit was told not to do. Treating that as out of scope rather than forcing a
finding around it.

### 27. Findings

**H22. ✅ Fixed.**
- **Current workflow:** a manager or admin has no way to know whether anything is waiting for their
  review without opening Manage and clicking into the Approvals tab specifically.
  `app-shell.tsx`'s nav badge logic only ever shows two things: `pendingCount` (pending
  *sign-ups*, on Settings) and `unseenActivityCount` (on Manage, but tied to the *Activity* tab,
  not Approvals). `pendingApprovals.length` — already computed in `workspace-store.tsx` and used
  by `ApprovalsPanel` itself — drives nothing outside that one tab.
- **Problem:** the single most time-sensitive manager action in the app (a submitted timesheet
  waiting on review) has zero passive visibility anywhere — not the sidebar nav, not the Manage
  tab list, not the Dashboard. A manager who doesn't habitually click into Approvals has no signal
  that they should.
- **Why it matters:** Dashboard already has a whole banner pattern built for exactly this shape of
  problem (`pendingCount > 0` → amber card, `src/routes/index.tsx`) — for admin-facing pending
  *sign-ups*. The same-shaped, arguably higher-stakes problem for pending *timesheets* has nothing
  equivalent, which means the thing most likely to actually block someone (an employee waiting on
  approval to know their week is settled) is the thing least likely to be noticed promptly.
- **Recommended improvement:** badge the "Manage" nav item with `pendingApprovals.length` (or a
  combined count with `unseenActivityCount`, distinguished by color/position) the same way
  `/settings` already gets badged with `pendingCount` — and/or add the same amber Dashboard-banner
  treatment used for pending sign-ups, scoped to `pendingApprovals`, so a manager sees "3 timesheets
  waiting on you" the moment they land on the Dashboard, not only after clicking into Manage on
  spec.
- **Priority:** High.
- **Complexity:** Low — the data (`pendingApprovals`) is already loaded workspace-wide; this is
  wiring an existing count into an existing badge pattern, not new data-fetching.

Fixed in `app-shell.tsx` and `routes/index.tsx`: the "Manage" nav badge now shows
`unseenActivityCount + pendingApprovals.length` (desktop sidebar, mobile "More" sheet, and the
mobile bottom-nav dot indicator all updated together), and the Dashboard gained a second amber
banner — "N timesheets waiting on your review," gated on `canManage`, linking straight into
Manage → Approvals — sitting above the existing pending-signups banner it was modeled on.

**M37. ✅ Fixed.**
- **Current workflow:** reviewing a submitted timesheet in `ApprovalsPanel` (Manage → Approvals)
  already expands to show the real entries behind it (`ApprovalEntries`) — but that view is
  read-only. If a manager spots something that needs fixing (wrong project, a typo in the
  description, a time that looks off), their only in-context option is **Send back** — rejecting
  the *entire* week with a note and waiting for the employee to fix and resubmit it. To correct it
  directly (an admin can, and a manager can for their own team, via `TeamEntriesTab`), they have to
  leave Approvals entirely, go to Manage → Entries, re-open the member picker, find the same
  person again, and page the week navigator back to the same week they were just looking at —
  with nothing carried over from where they came from.
- **Problem:** a one-field correction currently costs either a full reject-and-resubmit round trip
  (asking someone else to do the fix) or a multi-step manual re-navigation (doing it yourself, from
  scratch, with no continuity between the two tabs).
- **Why it matters:** this is exactly the "Corrections" + "Approve timesheets efficiently"
  intersection this audit was asked to look at — the two features (`ApprovalsPanel`,
  `TeamEntriesTab`) already exist and already do the right things individually, they just don't
  know about each other.
- **Recommended improvement:** an "Edit entries" action on each `ApprovalsPanel` row (or inside the
  expanded `ApprovalEntries` view) that jumps to Manage → Entries with that person and week already
  selected — `TeamEntriesTab` already accepts a `memberId`/`weekStart` via component state, so this
  is a matter of passing that state across tabs (e.g. lifting `tab`/`memberId`/`weekStart` up to
  `ManagePage` or via a search param) rather than building new editing UI.
- **Priority:** Medium — the reject-and-resubmit workaround exists and is safe, just heavier than
  necessary for a small fix.
- **Complexity:** Medium — no new data or mutations, but does need some cross-tab state plumbing in
  `manage.tsx` (currently each tab's state, like `TeamEntriesTab`'s `memberId`/`offset`, is local to
  that component).

Fixed in `manage.tsx`: `/manage` now has a `validateSearch` (`tab`/`memberId`/`weekStart`), and
each `ApprovalsPanel` row has an "Edit entries" button linking to
`/manage?tab=entries&memberId=...&weekStart=...`. `ManagePage` reads that search both on mount and
via an effect (since navigating there while already on `/manage` doesn't remount it), and passes
the target down as `initialMemberId`/`initialWeekStart` props; `TeamEntriesTab` seeds its
`memberId`/`offset` state from them. A manual tab click clears the carried-over target so a later
plain visit to Entries doesn't keep reapplying a stale deep link. Note: a manager (not admin)
landing here on a `Submitted` week still sees it read-only per the existing lock rule — this gives
them the same "why can't I edit this" context in place, it doesn't change who's allowed to edit.

**M38. ✅ Fixed.**
- **Current workflow:** Reports (`src/routes/reports.tsx`) offers exactly five date-range choices —
  `computeRange()`'s `this_week` / `this_month` / `last_30` / `this_quarter` / `this_year` — with
  no way to enter an arbitrary start/end date.
- **Problem:** none of the five presets can express "the pay period that ended last Thursday," a
  specific fortnight, or any custom range a manager actually needs for payroll or client billing
  purposes that don't happen to align with a calendar month/quarter.
- **Why it matters:** this is the literal "Filter dates" item this audit was asked to look for, and
  Reports is the one page whose entire purpose is answering "how many hours, over what period" —
  the one place a fixed preset list is most likely to not be enough.
- **Recommended improvement:** add a sixth option, "Custom," that reveals two date inputs (reusing
  the same `<Input type="date">` pattern already used in `EntryFormDialog`), feeding the same
  `{ from, to }` shape `computeRange()` already produces so nothing downstream (`projectHoursForRange`,
  `employeeHoursForRange`, the CSV export) needs to change.
- **Priority:** Medium.
- **Complexity:** Low-Medium — additive to the existing `RangePreset` union and `presetLabels`
  map, no new data-fetching shape.

Fixed in `reports.tsx`: `RangePreset` gained a `"custom"` member; picking it reveals two
`<Input type="date">` fields (`customFrom`/`customTo`) that feed the same `{ from, to }` shape as
every other preset, guarded against an inverted or empty range. The chart/table headings show the
actual `from`–`to` dates instead of a generic "Custom range" label once selected.

**M39. ✅ Fixed.**
- **Current workflow:** every member-heavy manager surface is either a flat, unfilterable
  `<Select>` or an unfilterable table: `TeamEntriesTab`'s member picker (`manage.tsx`), `ScheduleTab`'s
  roster table (`manage.tsx`), `WeekStatusPanel`'s status list (`manage.tsx`), and Settings →
  Users' approved-members table (`UsersTab`, `settings.tsx`, which does at least paginate at 10 per
  page, but still has no search or team filter ahead of that pagination).
- **Problem:** none of these let a manager type a name to jump to someone, or narrow the list to
  just their own team (relevant for an admin — every one of these shows *all* active members for
  an admin, unfiltered, unlike a manager's own view, which is already narrowed to shared-team
  members by `relevantMembers`'s existing `isAdmin` branch).
- **Why it matters:** this workspace's own seed data models 13 teams — at that scale, scrolling a
  flat picker or a paginated table to find one person is exactly the "too many clicks" this audit
  was asked to find, and it repeats in four separate places rather than being solved once.
- **Recommended improvement:** a single reusable member search+team-filter (a name `<Input>` plus a
  team `<Select>`, similar in spirit to `Projects → Clients`' already-existing search+filter
  bar in `ClientsTab`) used consistently across all four surfaces, rather than four separate
  one-off fixes — the underlying `members`/`activeMembers`/`teamIds` data every one of these
  already reads from is identical.
- **Priority:** Medium — genuinely useful today, more valuable as headcount grows.
- **Complexity:** Low-Medium — one shared component, reused; no new queries, since team
  membership (`teamIds`) is already loaded on every `WorkspaceMember`.

Fixed via a new shared `src/components/member-search-filter.tsx` (`MemberSearchFilter` +
`filterMembersBySearchAndTeam`), wired into all four surfaces: `WeekStatusPanel` and `ScheduleTab`
filter the list/table they render; `TeamEntriesTab` filters the member `<Select>`'s own option
list (keeping the currently-selected person visible even if since filtered out, same as the
existing since-deactivated-member handling); `UsersTab`'s approved-members table filters ahead of
its existing pagination. Each surface only shows the filter bar once its member count passes a
threshold (>8), so it doesn't add clutter to small teams.

**M40. ✅ Fixed.**
- **Current workflow:** `ActivityTab` (`manage.tsx`) renders every event in `activityLog`,
  grouped by week, with no filter of any kind.
- **Problem:** there's no way to answer "did anyone review X's timesheet" or "who changed Y's
  role" directly — only scroll through week-by-week groups looking for it.
- **Why it matters:** this is the literal "Review changes made by managers/admins" item this audit
  was asked to look for. The log itself is solid (already covers approvals, role changes, team
  membership, and entry edits-by-others, per the original audit's H11/M20 work) — it just doesn't
  scale to being *searched* the longer a workspace has been running, only *browsed*.
- **Recommended improvement:** a person filter (`<Select>` of members, matching against
  `actorId`/`targetUserId`) and/or an action-type filter, applied client-side over the already-loaded
  `activityLog` — no new query needed, this is the same shape of filter Reports already has for
  team/client.
- **Priority:** Medium — not broken, just doesn't scale to "search" the way it should for an
  audit-trail feature specifically.
- **Complexity:** Low — client-side filter over data already in context.

Fixed in `manage.tsx`'s `ActivityTab`: a person filter (built from everyone who's actually
appeared as an actor or target in the log, not the whole roster, so a removed person's history
stays findable) and an action-type filter (humanized labels for known actions, raw string
fallback for anything new), both applied client-side over the already-loaded `activityLog` before
the existing week-grouping. Only shown once there's more than one person or action type to filter
by; a filtered-to-nothing state gets its own "no matches" message distinct from the genuinely
empty-log state.

**L35. ✅ Fixed.**
- **Current workflow:** `WeekStatusPanel` (Manage → Approvals, `manage.tsx`) shows each team
  member's current-week timesheet *status* (Approved/Submitted/Rejected/Not submitted) but never
  their actual hours. Seeing "who's logged how many hours this week" means leaving Manage
  entirely, going to Reports, switching to the "By employee" tab, and setting the date preset to
  "This week."
- **Problem:** a manager scanning for who's behind on hours (not just who hasn't submitted yet —
  someone can be on-track with 30 logged hours and just not have clicked Submit) has to
  context-switch pages for a number that's directly adjacent, conceptually, to the status badge
  already shown.
- **Why it matters:** the literal "View weekly team hours" item this audit asked about — the
  closest existing surface (`WeekStatusPanel`) shows *whether* someone submitted, not *how much*
  they logged, which is often the more useful of the two at a glance.
- **Recommended improvement:** show each row's current-week total alongside the status badge,
  using `employeeHoursForRange` (already exists, already used by Reports for exactly this
  calculation) scoped to the current week.
- **Priority:** Low — the number is one page-trip away via Reports, not hidden.
- **Complexity:** Low — reuses an existing RPC; the only new work is calling it from
  `WeekStatusPanel` and rendering the result.

Fixed in `manage.tsx`'s `WeekStatusPanel`: fetches `employeeHoursForRange` for the current week on
mount/week-change and renders each row's total next to its status badge. A failed fetch just
leaves the hours column blank rather than breaking the status list, which is the more important
half of this panel.

**L36. ✅ Fixed.**
- **Current workflow:** `TeamEntriesTab` (Manage → Entries, `manage.tsx`) navigates week-by-week
  via prev/next chevrons only (`offset` state), with no "Today"/reset shortcut.
- **Problem:** after paging back several weeks for one person, then switching to a different
  person via the member picker, the week offset stays wherever it was left — there's no one-click
  way back to the current week.
- **Why it matters:** the personal Time page's own Calendar view already solved this exact problem
  (`goToday()` in `CalendarView`, `time.tsx` — added specifically because, per the original audit's
  L22, "Calendar view had no navigation at all... Added independent month/week paging plus a
  'Today' reset"). The manager-facing equivalent never inherited the same affordance.
- **Recommended improvement:** add the same `goToday`-style reset button next to `TeamEntriesTab`'s
  week navigator.
- **Priority:** Low.
- **Complexity:** Very low — copies an existing, already-proven pattern from `CalendarView`.

Fixed in `manage.tsx`'s `TeamEntriesTab`: a "Today" ghost button appears next to the week
navigator whenever `offset !== 0`, resetting it to the current week in one click.

### 28. Status Summary

- **Highest-value fix (H22):** pending approvals have no passive visibility anywhere in the app —
  the data already exists (`pendingApprovals.length`), it just isn't wired into the nav badge or
  Dashboard the way the analogous pending-signups case already is.
- **Real, repeated friction (M37–M40):** no link between reviewing a timesheet and correcting the
  entries behind it; Reports can't express a custom date range; four separate member-heavy manager
  surfaces each independently lack search/team-filtering instead of sharing one; the Activity log
  can be browsed but not searched. None of these are broken — they're each one extra
  page-switch, one long scroll, or one re-navigation more than the underlying data requires.
- **Small polish (L35, L36):** weekly hours are a page-trip away rather than shown inline next to
  submission status; the manager-facing week navigator never got the "Today" shortcut the personal
  Calendar view already has.
- **Explicitly out of scope:** "identify late attendance" has no answerable data model today
  (`weekly_schedule` is free text, not structured start/end times) and building one would cross
  into the "HR platform" territory this audit was told to avoid — noted once, not forced into a
  finding.
- **Already solid, no new finding needed:** permission boundaries are clearly communicated
  everywhere they apply (`ScheduleTab`/`TeamEntriesTab`'s explicit "Managers and admins only"
  empty states, `RoleCell`'s disabled-with-tooltip on your own role, self-review/self-approval
  blocked server-side per the original and QA audits) — this pass found nothing new to flag there.

### Files inspected this pass

`src/routes/manage.tsx` (all tabs: Approvals, Activity, Schedule, Entries), `src/routes/reports.tsx`,
`src/routes/settings.tsx` (Users, Admin tabs), `src/routes/teams.tsx`, `src/components/app-shell.tsx`
(nav badge logic), and `src/lib/workspace-store.tsx` (to confirm what member/approval/activity data
is already loaded and available to reuse, vs. what would need a new query).

---

## Final Product Review

Performed 2026-08-14, in a different chair than every pass above: not an engineer checking
correctness or completeness, but the product owner deciding whether Ironbrij's own team could stop
using Clockify tomorrow and use this instead — and, separately, re-verifying that everything the
five audits above already claimed "Fixed" is still actually true in the code today, not just true
in the doc. **No code was changed during this pass** — every item below is a finding or a status
correction, matched to this document's own severity conventions (C/H/M/L, numbering continuing
from C7/H22/M40/L36 above).

**Method:** read every route under `src/routes/`, every hook under `src/lib/workspace/`, all 37
files under `supabase/migrations/` in order, `src/lib/admin.functions.ts`,
`src/integrations/supabase/*`, `src/start.ts`, `src/server.ts`, and this document in full — then
spot-verified specific claims (grants, RLS, indexes, function definitions, current UI state)
directly against the code rather than trusting prior summaries. One verification limit worth
stating up front rather than burying in a footnote: this environment has no linked Supabase CLI
session and no service-role credential (`npx supabase migration list --linked` fails with an
IPv6/network error before it can even authenticate), so nothing here confirms what's actually
*deployed* to the live project — only what's committed. That gap is itself the single largest new
finding below (H23).

### 29. Verification of Prior Audits

Going through each pass above in order, confirming status against current code rather than the
doc's own prior wording:

- **Original audit (C1–C5, H6–H12, M13–M19, L20–L24):** spot-checked the highest-stakes claims
  directly — `time_entries_one_running_per_user` (C3) and `time_entries_no_overlap`'s `EXCLUDE`
  constraint (C4) both still exist exactly as described
  (`supabase/migrations/20260811020000_one_running_timer_per_user.sql`,
  `20260811030000_time_entries_no_overlap.sql`); `week_is_locked()`'s current definition
  (`20260811040000_lock_on_submit.sql`) still locks at `'submitted'`, not just `'approved'` (H6);
  `splitByDay`/midnight-splitting (H8) is still present in `use-time-entries.ts`. All confirmed
  still accurate. **No change.**
- **QA audit (H13–H15, M20–M23, L25–L27):** `src/components/app-shell.tsx` still gates on
  `loading`/`loadError` before rendering children (H13); `is_active_user()`
  (`20260812060000_require_active_for_privileged_access.sql`) is still folded into `has_role()`/
  `can_manage()` and wrapped directly around the `time_entries`/`timesheets` self-access policies —
  see H24 below for the part of H15's own stated scope that was never extended further. `busyIds`/
  `busyKeys` `Set`-based patterns (L25–L27) still present in `manage.tsx`/`settings.tsx`. **No
  change**, aside from the new H24 finding, which is a gap in what H15 covers, not a regression of
  what it already fixed.
- **Clockify Feature Parity audit (H16–H18, M24–M29, L30–L32):** **status correction applied** —
  L30 was still marked `⏳ Open` even though the Smart Automation audit's M33 built the exact
  feature it asked for (`CopyYesterdayButton`, confirmed live in `src/routes/time.tsx`); updated to
  `✅ Fixed` above with a note explaining the correction. Every other finding in this section is
  confirmed **still open**, re-checked directly: `reports.tsx` still has exactly two views (`"By
  project"` / `"By employee"`, line ~98) with no entry-level Detailed tab (H16) and no `$`/rate
  column anywhere (H17); `time-off.tsx` still imports `timeOffBalances`/`timeOffHistory` straight
  from `@/lib/mock-data` (M24); `entry-form-dialog.tsx` still has no `is_billable` field at all
  (M26); `reports.tsx` never references `is_billable` on either tab (M28); Settings → Notifications
  is still every switch `disabled` (M29); and — worth calling out specifically since it was a named
  recommendation, not just an open finding — the three permanently-"coming soon" Manage tabs
  (Expenses, Kiosks, Invoices) this audit recommended removing are **still in the `sections` array**
  in `manage.tsx` verbatim, unacted-on across two subsequent audit passes. Elevated to its own
  finding below (M42) since "recommended twice, done neither time" is a stronger signal than a
  first-pass suggestion.
- **Smart Automation audit (H19, M30–M33, L33):** all five spot-checked directly and confirmed
  present: the unsubmitted-past-weeks banner and last-week recap card both render in
  `src/routes/index.tsx`; `CopyYesterdayButton` exists in `time.tsx`; the bulk-approve checkboxes
  and confirmation dialog exist in `ApprovalsPanel` (`manage.tsx`). **No change.**
- **Database & Data Integrity audit (C6, C7, H20, H21, M34–M36, L34):** the two Critical fixes'
  migration files both exist exactly as the doc describes —
  `20260814000000_revoke_profiles_delete.sql` (drops `profiles_delete_admin`, revokes `DELETE` from
  `authenticated`) and `20260814010000_time_entries_server_side_duration.sql` (the
  `compute_time_entry_duration()` trigger) are both present and match their descriptions verbatim.
  **What can't be confirmed from this repo:** whether either migration has actually reached the
  live database — see H23. The remaining recommendations (H20, H21, M34–M36, L34) are confirmed
  still open exactly as described — no new migration files exist beyond the two above, and the
  client-code gaps they describe (the profile-bootstrap insert's missing `.catch()` in
  `use-members.ts`, the `tag_ids` array never cleaned up in `use-tags.ts`) are still present
  verbatim.
- **Manager & Admin Workflow audit (H22, M37–M40, L35, L36):** implemented in the session
  immediately preceding this one. Re-verified directly rather than trusting the "✅ Fixed" markers
  just written: `app-shell.tsx`'s nav badge now reads `unseenActivityCount + pendingApprovals.length`
  for `/manage`; `src/routes/index.tsx` has the second amber banner gated on `canManage`; `/manage`'s
  `validateSearch` and `ApprovalsPanel`'s "Edit entries" link both exist in `manage.tsx`; `reports.tsx`
  has a `"custom"` `RangePreset` with the inverted/empty-range guard; `member-search-filter.tsx`
  exists and is imported into `manage.tsx` and `settings.tsx`; `ActivityTab` has person/action
  filters; `WeekStatusPanel` calls `employeeHoursForRange`; `TeamEntriesTab` has the "Today" reset
  button. All confirmed present and matching the doc's descriptions. **Caveat carried forward
  honestly, not new:** this was verified by `tsc --noEmit`, ESLint, and a production build, not by
  driving the actual app in a browser — this repo has no linked Supabase credentials in this
  environment, so no code in this document (old or new) has ever been through an actual browser
  session against live data during any of these six audit passes. Worth naming plainly rather than
  implying a browser-tested confidence level that was never actually achieved. **One narrow bug
  found in this session's own implementation** during this pass — see L38 below: the `/manage`
  deep-link's `TeamEntriesTab` seeds `memberId`/`offset` from props via a `useState` initializer,
  which only runs on mount; two consecutive "Edit entries" deep-links without an intervening
  unmount (reachable via browser back/forward or a second pasted link, not the normal single-click
  path) leave the tab showing the first target instead of the second. Everything else in
  H22/M37–M40/L35/L36 checked out clean, including the just-added `MemberSearchFilter`'s handling
  of an unfiltered/empty search and a member with no teams, and `WeekStatusPanel`'s graceful
  degradation when the `employeeHoursForRange` fetch fails.

### 30. New Findings

**H23. ⚠️ Improved — the specific launch-blocking risk is closed, the systemic gap isn't. No
confirmed migration-deployment pipeline — every "Fixed" DB-level finding in this document is a
committed file, not a verified live change.**
- **Current behavior:** `supabase/config.toml` only pins a `project_id`; there's no
  `.github/workflows/`, no CI of any kind, and no script anywhere in `package.json` that applies
  migrations. `npx supabase migration list --linked` fails outright in this environment
  (`LegacyDbConfigIpv6Error`) before it can even compare local vs. remote migration state.
- **Why it matters:** this document has, across five prior passes, described 7 Critical and roughly
  a dozen High findings as "✅ Fixed" specifically *because* a migration file exists — but a
  migration file existing in `supabase/migrations/` and that migration having actually run against
  Ironbrij's real project (`cdzsgstdndbebdatijav`) are two different facts, and nothing in this
  repository, this environment, or this document confirms the second one. If — for any reason —
  deployment isn't automatic on merge (Lovable's own sync behavior for schema changes specifically,
  as opposed to app code, isn't something this repo documents), then some subset of C1–C7 could
  still be **exploitable in production today** despite being marked fixed here five times over.
  This is the single highest-leverage unknown for a launch decision, precisely because it's
  invisible from the code alone — a `⏳ Open` finding that would silently invalidate other
  `✅ Fixed` ones if it turned out to be true.
- **Recommended action:** before treating any DB-level finding in this document as actually
  resolved, someone with real project access needs to run `supabase migration list --linked`
  (or check the Supabase dashboard's migration history directly) and confirm every file under
  `supabase/migrations/` — especially the two most recent, `20260814000000` and `20260814010000` —
  shows as applied. This is a five-minute check with an outsized payoff: it either closes this
  finding immediately or reveals that several "Fixed" Critical issues need to be re-escalated.
- **Priority:** High — not because the fix is complex, but because it's the one thing this document
  cannot self-verify, and a launch decision built on unverified "Fixed" markers is the actual risk.
- **Complexity:** Very low (a CLI command or dashboard check) once someone has real credentials;
  this environment doesn't have them.

**Verified 2026-08-14, same day:** the product owner checked the Supabase dashboard's migration
history directly against the live project (`cdzsgstdndbebdatijav`) and confirmed the two most
recent migrations — `20260814000000_revoke_profiles_delete` and
`20260814010000_time_entries_server_side_duration`, the ones the two Critical findings (C6, C7)
depend on — both show as applied. That closes the specific launch-blocking risk this finding was
raised for: C6/C7 are confirmed live, not just committed. Marked `⚠️ Improved` rather than
`✅ Fixed` because the underlying systemic gap — no CI, no automated check that a future migration
actually reaches production — is still real and will recur for every migration after these two
unless a real pipeline exists; this was a one-time manual check, not a fix to the process itself.

**H24. ✅ Fixed 2026-08-14. `is_active_user()` protects `time_entries`/`timesheets` only — nine other
tables' `SELECT` policies still trust a live JWT alone.**
- **Current behavior:** H15 (QA audit) added `is_active_user(auth.uid())` directly into the
  self-access branches of `time_entries` and `timesheets` policies specifically, and folded it into
  `has_role()`/`can_manage()` for everything gated by those. But `profiles_select_all`,
  `teams_select_all`, `team_members_select_all`, `clients_select_all`, `tags_select_all`,
  `projects_select_all`, `project_members_select_all`, `project_tags_select_all`, and
  `settings_select_all` (all `20260804000910_5a7605fb-...sql`) are still bare
  `FOR SELECT TO authenticated USING (true)` — confirmed via direct grep across every migration for
  `is_active_user`, which appears only in `20260812060000_require_active_for_privileged_access.sql`
  and nowhere else.
- **Why it matters:** this is exactly the class of gap H15 was written to close — "access
  revocation relied entirely on `deleteUser()` invalidating an already-issued token, with no
  app-level backstop" — just for nine tables H15's own fix never reached. In practice today the
  blast radius is narrower than it sounds: `removeUserAccess()` (`admin.functions.ts`) always calls
  `supabaseAdmin.auth.admin.deleteUser()` in the same transaction-adjacent sequence that flips
  `is_active = false`, and there's no other code path in this app that sets `is_active = false`
  without also deleting the auth user — so this can only matter during the narrow window (if any)
  between `deleteUser()` being called and an already-issued, still-unexpired access token actually
  expiring, the exact same window H15 already had to reason about for the two tables it did cover.
  For those nine tables, that narrow window exposes read access to the org directory
  (names/emails/roles), every team, every client, every project, and every tag — not payroll data,
  but real PII and internal structure.
- **Recommended solution:** wrap the same nine `USING (true)` policies in
  `is_active_user(auth.uid()) AND (...)`, mirroring exactly how H15 already did it for
  `time_entries`/`timesheets` — same function, same pattern, no new logic to design.
- **Priority:** High — same risk shape H15 was already rated High for; narrower data sensitivity
  (directory/PII, not payroll) is the only reason it's not Critical.
- **Complexity:** Low — one migration, additive `AND` clauses on nine existing policies, no data
  backfill.

**Fixed in `20260814020000_extend_is_active_to_read_policies.sql`:** all nine policies now read
`USING (public.is_active_user(auth.uid()))`, exactly the recommended pattern — no other logic
changed.

**H25. ✅ Fixed 2026-08-14. The signed-in user's own `time_entries` fetch has no row limit — a heavy
user's 400-day history can silently truncate exactly the way H10 already fixed once.**
- **Current behavior:** `useTimeEntriesData`'s `entriesQ` (`src/lib/workspace/use-time-entries.ts`,
  around line 89) fetches every row for the signed-in user from `ENTRIES_HISTORY_DAYS` (400 days)
  ago to now, with `.gte("entry_date", ...)` and `.order(...)` but **no `.limit()` and no
  pagination** — the query relies entirely on PostgREST's own default row cap (commonly 1000 unless
  a project has changed `db-max-rows`) to stop it, silently, rather than the app ever deciding on a
  bound itself.
- **Why it matters:** H10 in the original audit is literally titled "History views silently showed
  wrong (empty) data past a hardcoded 60-day window, indistinguishable from a genuinely empty
  week" — fixed by widening the window and having the UI explain the edge honestly. This finding is
  the same failure shape from a different cause: someone logging ~3 entries/day for the full
  400-day window is already at 1,200 rows — comfortably past a 1000-row PostgREST default — with no
  error, no explanation, just an oldest slice of their own history quietly missing from Reports,
  the Calendar view, and their own week totals. This is exactly the "silently wrong, not obviously
  broken" case this document has already treated as High-severity once.
- **Recommended solution:** either add an explicit `.limit()` well above realistic usage (e.g. 5000)
  so a future silent truncation at least happens at a size someone would actually hit and can be
  raised as a real bug, or paginate the fetch properly with `.range()` — the latter is more correct
  long-term given the window is already 400 days and only grows as tenure grows.
- **Priority:** High — same reasoning as H10's original severity; this is the same bug class
  recurring through a different mechanism, not a new category of risk.
- **Complexity:** Low-Medium — a `.limit()` bump is trivial; proper pagination touches the query
  shape more.

**Fixed:** took the `.limit()` option — `entriesQ` now caps at 5000 rows (`use-time-entries.ts`),
comfortably above `ENTRIES_HISTORY_DAYS` (400 days) at realistic entry volume, so a future silent
truncation would at least happen at a size someone would actually raise as a bug rather than
silently swallowing the tail of a normal power user's history. Proper `.range()` pagination is still
the more correct long-term fix if usage ever approaches that bound; left as a future item, not done
here.

**H26. ✅ Fixed 2026-08-14. `resendInvite()` calls `listUsers()` with no pagination — silently can't
find anyone past the first 50 accounts.**
- **Current behavior:** `resendInvite` (`src/lib/admin.functions.ts`, line 140) calls
  `supabaseAdmin.auth.admin.listUsers()` with no arguments, then does
  `users.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase())`. Supabase's admin
  `listUsers()` defaults to `page: 1, perPage: 50` — anyone whose account isn't on that first page
  is invisible to this lookup and gets "No account found for that email — invite them first" even
  though they're a real, already-invited pending signup.
- **Why it matters:** CLAUDE.md describes this workspace as spanning **13 teams**. A staffing/VA
  agency with 13 teams comfortably has more than 50 total accounts (active plus ever-invited), which
  makes this not a hypothetical edge case but a routine one — any admin resending an invite to
  someone whose account happens to sort past page 1 gets a confusing, actively wrong error message
  ("invite them first" for someone who's already invited) instead of the resend actually working.
- **Recommended solution:** loop `listUsers({ page, perPage: 1000 })` until a page comes back
  short, or (better) query Supabase's own `profiles` table by email first (already unique, already
  indexed via the primary key path) to get the `id`, then call `generateLink` directly — skipping
  `listUsers()`'s pagination problem entirely rather than working around it.
- **Priority:** High — silent, incorrect failure on a routine admin action, at a scale this specific
  workspace already exceeds by design.
- **Complexity:** Low.

**Fixed:** took the second (better) recommended option — `resendInvite()` now looks up the
`profiles` row by email (`.ilike("email", data.email).maybeSingle()`) to confirm the account exists,
skipping `listUsers()`'s pagination problem entirely instead of looping around it.

**M41. ✅ Fixed 2026-08-25. Two unbounded, workspace-wide fetches with no cap: `timesheetsQ` and
`activity_log`'s missing index.**
- **Current behavior:** `useTimesheetsData`'s `timesheetsQ` (`src/lib/workspace/use-timesheets.ts`,
  line 18) fetches **every** `timesheets` row RLS lets the viewer see — for an admin, that's every
  timesheet ever submitted, workspace-wide, forever, with no `.limit()` and no date bound. Loaded on
  every session for anyone with `canManage`. Separately, `activity_log` is correctly capped at 300
  rows client-side (`use-activity-log.ts`, `.limit(300)`) but that query's `ORDER BY created_at
  DESC LIMIT 300` has no matching index — `CREATE INDEX ... ON activity_log` never appears anywhere
  in `supabase/migrations/`, unlike `time_entries_user_date_idx` and `timesheets_user_week_idx`,
  which do exist for exactly the columns their own queries filter/sort by.
- **Why it matters:** both degrade gracefully today (small dataset, since this is a pre-launch
  workspace per H18) but get strictly worse with tenure — `timesheetsQ` grows by
  `active_members × 52` rows a year with zero cap, and `activity_log` is genuinely append-only with
  no retention policy anywhere in this schema. Neither is urgent for day one; both are worth fixing
  before they're the thing someone has to diagnose two years in.
- **Recommended solution:** bound `timesheetsQ` to a rolling window (mirroring
  `ENTRIES_HISTORY_DAYS`'s own precedent) rather than fetching all-time; add
  `CREATE INDEX activity_log_created_at_idx ON activity_log (created_at DESC)`.
- **Priority:** Medium — real, but this workspace's actual current data volume means it's not
  urgent.
- **Complexity:** Low for the index; Low-Medium for bounding `timesheetsQ` (touches what "all
  timesheets" means for Reports/Approvals elsewhere in the app, needs a quick check nothing else
  assumes the full history is always loaded).

**Fixed:** both pieces, exactly as recommended. `timesheetsQ` now bounds to
`.gte("week_start", toDateKey(oldestLoadedWeekStart()))` — the same rolling window `entries` already
uses — after confirming nothing that reads `timesheets` (Approvals, week-status lookups, the H19
Dashboard banner, L33's last-week recap) ever looks further back than that boundary anyway, since
Timesheet's own week-nav already refuses to page any further (H10/L22). Added
`CREATE INDEX activity_log_created_at_idx ON activity_log (created_at DESC)`
(`20260825070000_activity_log_created_at_index.sql`).

**M42. ✅ Fixed 2026-08-14. Three permanently-"coming soon" Manage tabs, recommended for removal
once already, still present.**
- **Current behavior:** `manage.tsx`'s `sections` array still includes `expenses`, `kiosks`, and
  `invoices` — each rendering the same static "coming soon"/"scope still being confirmed" empty
  state it did at the Clockify Parity audit, which explicitly recommended removing them (section 15
  of that audit, above) rather than leaving dead tabs promising unbuilt functionality.
- **Why it matters:** this isn't a new observation, it's the same one going unactioned across two
  further audit passes (Smart Automation, Database Integrity) that both touched `manage.tsx`
  directly (the Manager & Admin Workflow audit even added new UI to two of the other tabs in this
  same file). Every day this ships as-is, it's the literal first thing a new Ironbrij user clicking
  through Manage's tab bar sees three broken promises before finding the parts of the app that
  actually work. Elevated to its own finding specifically because "recommended and then repeatedly
  not acted on" is a stronger, more actionable signal than a first-pass suggestion buried in a
  "Considered and Rejected" list.
- **Recommended action:** this remains a five-minute decision away from being resolved either
  direction — delete the three entries from `sections` (`manage.tsx`), or keep them and set a real
  target date. The audit's own recommendation stands: don't leave them as permanent placeholders.
- **Priority:** Medium — nothing is broken, but shipping three dead-end tabs to real users on day
  one actively contradicts "simple, easy to use."
- **Complexity:** Very low to remove (delete three array entries); the alternative (build them) is
  its own, much larger scope already covered by H17 (billing) and explicitly rejected for
  Kiosks/Invoices in section 15 above.

**Fixed:** took the removal option — deleted the `expenses`/`kiosks`/`invoices` entries from
`sections` in `manage.tsx`, along with the now-unreferenced `Receipt`/`MonitorSmartphone`/`FileText`
icon imports and the generic "coming soon" `<Card>` fallback branch that only those three tabs ever
rendered (with all four remaining tabs handled by an explicit branch, that fallback was dead code
once the placeholders were gone). Also trimmed the now-inaccurate "expenses... kiosks and invoices"
wording from the route's own `head()` meta description.

**M43. ⏳ Open. No automated test suite, no CI — every fix in this document (40+ and counting) is
verified by hand, once, and never re-verified automatically again.**
- **Current behavior:** confirmed via `package.json` (`scripts`: `dev`, `build`, `build:dev`,
  `preview`, `lint`, `format` — no `test`) and the absence of any `.github/workflows/` directory.
  CLAUDE.md states this plainly too ("There is no test suite / test script in this repo
  currently").
- **Why it matters:** this document is, functionally, the regression-prevention mechanism for this
  application — six audit passes, each re-reading large swaths of the same files to confirm nothing
  regressed since the last pass (see section 29 above, which is exactly that exercise). That's a
  real, working process, but it's manual, expensive to repeat, and only as thorough as whoever's
  running it that day. A payroll-adjacent app with this many defense-in-depth business rules
  (overlap checks, locking, self-review blocks, last-admin protection) is exactly the shape of
  system where a silent regression in one of them is the kind of bug that's easy to miss by eye and
  expensive to have missed in production.
- **Recommended action:** not a call to build exhaustive coverage — even a handful of integration
  tests against the highest-stakes `SECURITY DEFINER` functions (`submit_timesheet`,
  `review_timesheet`, `set_member_role`) would catch the exact class of regression this document's
  own audits keep having to re-verify by hand.
- **Priority:** Medium — a process/maintainability risk, not a user-facing bug today.
- **Complexity:** Medium — needs picking a test runner and a way to run migrations against a local
  Postgres/Supabase instance in CI, which doesn't exist yet either.

**M44. ✅ Fixed — already resolved before this document was updated to say so.** The Projects tab has no search, filter, or pagination — the busiest list in the app
has less findability than the Clients tab one click away in the same file.**
- **Current behavior:** `projects.tsx:198-294` renders every project as an unconditional
  `projects.map(...)` grid of cards, with no name search, no team/client filter, and no pagination.
  The **Clients** tab in the exact same file already has all three — a search input, a "Show
  inactive" toggle, and pagination at `CLIENTS_PAGE_SIZE = 10` (`projects.tsx:619, 670-690`) — and
  Projects is very likely the more populated of the two lists for a 13-team agency running many
  concurrent client projects.
- **Why it matters:** this is the exact shape of gap the Manager & Admin Workflow audit's M39 just
  fixed for member-heavy surfaces (`WeekStatusPanel`, `ScheduleTab`, `TeamEntriesTab`'s picker,
  Settings → Users) — that audit was explicitly scoped to "member-heavy manager surfaces," so
  Projects, which has the identical scrolling/findability problem on a different data model, was
  never in scope to catch it.
- **Recommended solution:** the same pattern `MemberSearchFilter`/`filterMembersBySearchAndTeam`
  (`src/components/member-search-filter.tsx`) already established — a name search plus a team
  filter (and optionally a client filter, mirroring Reports' own team/client filter pair) — applied
  to `projects.tsx`'s existing `projects` array; no new query, `projects`/`teams`/`clients` are
  already loaded workspace-wide.
- **Priority:** Medium — real friction once past a couple dozen projects, not urgent at whatever
  Ironbrij's actual current project count is.
- **Complexity:** Low — same reusable-component pattern M39 already proved out, just pointed at
  projects instead of members.

**Fixed — status corrected 2026-08-25, not fixed as part of this pass.** Commit `c155050`
("Add project pagination and an 'All teams' option," 2026-08-18, between this audit pass and the
next commit on the branch) already shipped `PROJECTS_PAGE_SIZE`, a search input, and a team filter
on `projects.tsx` — confirmed by reading the current file directly. This finding's own marker was
simply never updated when that shipped, the same class of drift L30 called out and corrected once
already. Marking fixed here rather than leaving it permanently open for something that's actually
done.

**L37. ✅ Fixed 2026-08-25. No `typecheck` script in `package.json` despite the codebase relying on `tsc
--noEmit` for verification.**
- **Current behavior:** `package.json`'s `scripts` has `lint` (ESLint) and `format` (Prettier) but
  nothing that runs the TypeScript compiler in check-only mode — every verification pass in this
  document's history (including the Manager & Admin Workflow implementation immediately preceding
  this one) has had to invoke `npx tsc --noEmit` directly rather than a documented `npm run
  typecheck`.
- **Why it matters:** minor, but it's the kind of thing that's easy to forget to run precisely
  because it isn't in the list of documented commands (`CLAUDE.md`'s own "Commands" section doesn't
  mention it either).
- **Priority:** Low.
- **Complexity:** Trivial — `"typecheck": "tsc --noEmit"`.

**Fixed:** added `"typecheck": "tsc --noEmit"` to `package.json`, and added it to `CLAUDE.md`'s own
"Commands" section too — the second half of this finding's complaint ("it isn't in the list of
documented commands") would otherwise still be true even with the script added.

**L38. ✅ Fixed 2026-08-14. `/manage`'s deep-linked `TeamEntriesTab` doesn't re-sync on a second
consecutive deep-link while already mounted — a real, narrow bug in this session's own M37
implementation.**
- **Current behavior:** `TeamEntriesTab` (`manage.tsx`) seeds its `memberId`/`offset` state from
  `initialMemberId`/`initialWeekStart` props via `useState(initialMemberId ?? "")` and a
  `useState(() => ...)` initializer — both of which only ever run once, on mount. `ManagePage`
  itself correctly updates its own `entriesTarget` state on every search-param change (the
  `useEffect` added alongside `validateSearch`), but since `TeamEntriesTab` stays mounted across
  that update (same ternary branch, tab doesn't change), its internal state never re-syncs to the
  new props. Landing on `/manage?tab=entries&memberId=A&weekStart=W1`, then navigating directly to
  `/manage?tab=entries&memberId=B&weekStart=W2` (browser back/forward after two "Edit entries"
  clicks, or a second pasted link) leaves the tab still showing person A's week W1.
- **Why it matters:** narrow — unreachable via the single normal click path ("Edit entries" from a
  different tab always remounts cleanly, since the tab itself changes) — but it's a real
  data-display bug, not a hypothetical one, in code that shipped this same session.
- **Recommended solution:** key the component on the target itself —
  `<TeamEntriesTab key={\`${entriesTarget?.memberId}-${entriesTarget?.weekStart}\`} .../>` in
  `ManagePage` — forcing a clean remount (and therefore a fresh `useState` initializer run) on every
  distinct deep-link, one line, no logic change inside `TeamEntriesTab` itself.
- **Priority:** Low — narrow reachability, no data is lost or written incorrectly, just displayed
  against the wrong context until the person re-selects manually.
- **Complexity:** Trivial — a single `key` prop.

**Fixed:** exactly the recommended one-line change — `<TeamEntriesTab>` in `ManagePage` is now keyed
on `` `${entriesTarget?.memberId ?? ""}-${entriesTarget?.weekStart ?? ""}` ``, forcing a clean
remount (and fresh `useState` initializer run) on every distinct deep-link target.

**L39. ✅ Fixed 2026-08-25. No empty-state message when a project picker has nothing to show.** `TimerBar`
(`time.tsx`) and `EntryFormDialog` (`entry-form-dialog.tsx`) both render a plain, empty
`<Select>` with no explanatory copy if every project is archived or none exist yet — a first-day
workspace with no projects created hits this immediately, sees an empty dropdown, then only
learns why on submit via a generic "Pick a project first" error.
- **Priority:** Low. **Complexity:** Very low — one conditional empty-state message per picker.

**Fixed:** a small muted-text hint ("No projects yet — ask an admin to create one") now appears
under both pickers when there are zero active projects. Worth noting: `TimerBar`'s picker is no
longer ever *truly* empty since the "Allow timer-less starts" change (2026-08-19) added a permanent
"No project" option to it — this finding's original "cryptic empty dropdown" framing applies more
squarely to `EntryFormDialog` now, which still requires a real project for a manual entry and has no
such fallback option. Fixed in both anyway, for the same "why is there nothing to pick" clarity.

**L40. ✅ Fixed 2026-08-25. The Timesheet Grid lists every non-archived project as a row every week, even ones
with zero hours that week.** `timesheet-grid.tsx` includes any project that's either non-archived
or has at least one non-zero day — meaning every active project shows up regardless of whether it
was touched that week, which for a workspace with many concurrent projects turns the weekly grid
into mostly `—` cells to scroll past to find the two or three rows with real data.
- **Priority:** Low today, worth revisiting as Medium once project counts grow. **Complexity:**
  Low — filter to rows with a non-zero weekly total, or add a "hide empty rows" toggle.

**Fixed:** took the toggle option over an unconditional filter — a "Hide rows with nothing logged
this week" checkbox (default off, so nothing changes unless asked for) above the grid. An
unconditional filter was deliberately avoided: seeing every assigned project, even at zero, is
sometimes exactly the point (a checklist of what's expected that week), so this preserves both
behaviors rather than picking one.

### 31. Top 10 Issues (fix before replacing Clockify)

Ranked by actual day-one impact on Ironbrij's team, not by document order. **H23 has been resolved
and removed from this list** — the product owner checked the Supabase dashboard directly on
2026-08-14 and confirmed both `20260814000000` and `20260814010000` (the migrations C6/C7 depend
on) are live; see H23's own entry above for the full note. Five more items below (H25, H24, H26,
M42, H20) were implemented the same day and are marked accordingly, kept in place rather than
renumbered so the list still reads as a record of what this pass identified.

**Update 2026-08-25:** H16 and H17 (below) are now also fixed — see each entry above for detail.
**The genuinely open remainder of this list is now just H18, M29, M24** — the two of those three
that are engineering work (H16/H17) are done; what's left is a real service-role-credentialed
cutover run (H18) and two product decisions (M29, M24), none of which this pass could do from here.

1. **H18 — No path to bring historical Clockify data across.** ⚠️ Improved 2026-08-14 — the tool
   (`scripts/import-clockify-history.mjs`) is built and validated against a real Clockify export;
   what's left is running it against the real project, not more engineering.
2. **H16 — ✅ Fixed 2026-08-25.** No entry-level Detailed report — an agency billing clients by the
   hour needs entry-level backup, not just project totals, to justify an invoice. A new Detailed
   Reports tab (searchable, filterable, paginated, CSV-exportable) now covers this.
3. **H17 — ✅ Fixed 2026-08-25.** No cost/billing ($) report — "what did we spend/bill this month"
   was unanswerable in-app despite every input (`hourly_rate`, `is_billable`) already existing. An
   Amount column (billable hours × rate) on Reports' employee view now covers this.
4. **H25 — ✅ Fixed 2026-08-14.** Own time-entry history can silently truncate past ~400 days of
   real use — the exact failure shape H10 already cost real effort to fix once, from a new cause.
   `entriesQ` now carries an explicit `.limit(5000)`.
5. **H24 — ✅ Fixed 2026-08-14.** Nine tables' read policies didn't check `is_active` — same fix H15
   already proved out for two tables, now extended to the rest
   (`20260814020000_extend_is_active_to_read_policies.sql`).
6. **H26 — ✅ Fixed 2026-08-14.** `resendInvite` silently failed past 50 accounts, not hypothetical
   at "13 teams" scale — now looks the account up by email in `profiles` directly instead of paging
   through `listUsers()`.
7. **M29 — Notifications are entirely non-functional.** No one gets told a timesheet is waiting on
   them except by opening the app and looking; the one delivery mechanism a real team relies on
   (email/Slack-style nudges) doesn't exist here at all yet.
8. **M24 — Time off is 100% fake.** If Ironbrij's team currently tracks leave in Clockify, this is a
   hard regression on day one, not a missing nice-to-have.
9. **M42 — ✅ Fixed 2026-08-14.** The three dead "coming soon" tabs are removed from `manage.tsx`
   entirely, along with their now-dead fallback rendering branch.
10. **H20 — ✅ Fixed 2026-08-14.** `submit_timesheet()`'s running-timer check and its own submit/lock
    weren't atomic — a second tab/device could start a timer in the narrow window between the check
    and the commit, re-trapping it inside a now-locked week. Fixed with a shared row-lock on the
    user's own `profiles` row, taken by both `submit_timesheet()` and a new `BEFORE INSERT` trigger
    on `time_entries` for timer-starts, serializing the two against each other
    (`20260814030000_atomic_submit_timesheet_lock.sql`).

### 32. Top 10 Improvements (quality-of-life, not launch-blocking)

**Update 2026-08-25: 9 of these 10 are now fixed** — only M43 (automated tests) remains, kept in
place below rather than renumbered so this still reads as a record of what this pass identified.

1. **M26 — ✅ Fixed 2026-08-25. Per-entry billable override.** A billable project still has real
   non-billable moments (internal syncs, rework); couldn't be excluded before without polluting
   project-level totals. `EntryFormDialog` now has a billable checkbox, defaulting to the project's
   own setting but overridable.
2. **M28 — ✅ Fixed 2026-08-25. Billable vs. non-billable split in Reports.** The data
   (`is_billable`) existed but nothing surfaced it cross-team — both Reports tabs now have a
   Billable column (hours + %).
3. **M44 — ✅ Fixed — already done before this document said so (see M44's own entry above).**
   Search/filter/pagination on the Projects tab.
4. **M27 — ✅ Fixed 2026-08-25. Project-level budget/estimated-hours tracking.** Clients already had
   this (`subscription_hours`); individual fixed-scope projects now have their own `budget_hours`
   too, with the same over/near-budget badges.
5. **M41 — ✅ Fixed 2026-08-25. Bound `timesheetsQ`, index `activity_log`.** Both done, before either
   became a real slowdown rather than a theoretical one.
6. **M35 — ✅ Fixed 2026-08-25. Clean up dangling `tag_ids` on tag deletion.** `delete_tag()` now
   strips the id from every entry first, atomically with the delete.
7. **M34 — ✅ Fixed 2026-08-25. Constrain/normalize `timesheets.week_start` to Monday server-side.**
   `submit_timesheet()` now normalizes via `date_trunc('week', ...)`.
8. **M36 — ✅ Fixed 2026-08-25. Derive `entry_date` server-side from `start_time` + the entry owner's
   timezone.** A new trigger closes this drift risk for a team explicitly distributed across
   timezones — see M36's own entry for a documented, accepted edge case with H8/M21's day-splitting.
9. **L34 — ✅ Fixed 2026-08-25. Add error handling to the profile-bootstrap insert.** A brand-new
   user's very first sign-in can no longer fail silently with no retry affordance.
10. **M43 — ⏳ Still open. A handful of integration tests around the highest-stakes `SECURITY
    DEFINER` functions.** Not full coverage — just enough to make the next audit pass faster and
    less error-prone than this one and the six before it. The one item on this list this pass didn't
    touch — needs a test runner and a way to run migrations against a local Postgres/Supabase
    instance in CI, neither of which exist yet, a bigger lift than everything else here.

### 33. Features We Should NOT Build

Reaffirming the Clockify Parity audit's own "Considered and Rejected" list (section 15 above) —
nothing found in this pass changes any of those calls, and re-litigating them here would be exactly
the kind of scope creep this instruction set was explicit about avoiding:

- **In-app invoicing/expense tracking.** Xero is already Ironbrij's accounting system of record;
  duplicating it here competes with, rather than complements, that. H17 (a `$` figure to hand to
  Xero or a client) covers the genuinely useful subset without building an invoicing system.
- **Kiosk/shared-terminal clock-in.** No on-site staff to serve; every person already signs in
  individually.
- **Idle/away detection.** Needs a native desktop agent a browser tab structurally can't provide;
  the existing 4/8/12h running-timer warning already covers the practical case.
- **Time rounding / minimum-increment rules.** Solves an invoice-dispute problem this internal tool
  doesn't have — the underlying entries are already the source of truth, not a customer-facing
  rounded number.
- **A discrete "Break" control.** Already fully expressible as the gap between stopping one timer
  and starting the next; a dedicated concept wouldn't change what's recorded, just add a button.
- **AI-suggested descriptions/auto-categorization.** Out of scope per this review's own
  instructions, and unneeded — the existing recency-based "Recent" grouping already gets someone to
  their usual project/task in one click with no inference involved.
- **New for this pass — a full leave/HR platform.** M24's real fix (build a minimal
  request→approve leave workflow, or remove the page) should stay minimal and modeled on the
  timesheet approval pattern that already works — not grow into shift scheduling, accrual rules, or
  anything HR-platform-shaped, which every prior audit has correctly kept out of scope.
- **New for this pass — a full BI/pivot-table reporting tool for H16's Detailed report.** A
  filterable, exportable table of raw entries is the actual ask (matches what Clockify's own
  Detailed report is) — not a build-your-own-report-builder. Keep it as simple as the existing two
  Reports tabs.
- **New for this pass — a permanent CSV/API importer UI for H18.** A one-time admin-run script, used
  once at cutover and then deleted, is enough — building permanent importer UI for a need that only
  ever happens once is the wrong trade for a tool that's supposed to stay simple.

### 34. Logic That Needs Strengthening

Business logic and data-integrity rules that are directionally correct today but have a real,
identifiable gap — distinct from missing features above. **Update 2026-08-25: every item in this
list is now fixed** (H20, H24, H25 were already fixed 2026-08-14; H21, M34, M35, M36 were fixed this
pass — see each finding's own entry above for detail). Left as a historical snapshot of what this
pass identified, not rewritten into a status list:

- **H20 — `submit_timesheet()`'s running-timer check and its own submit/lock aren't atomic.** A
  second tab/device can start a timer in the narrow window between the check and the commit,
  re-trapping a timer inside a now-locked week — precisely the bug `lock_on_submit.sql` already
  went out of its way to prevent, reintroduced via a race instead of a missing check.
- **H21 — the multi-day timer split (`stopTimer`) isn't one transaction.** A failure partway through
  a 3+-day split can leave later segments committed but the original entry stuck `running`
  indefinitely, with no automated recovery — visible, not silent, but entirely manual to fix.
- **H24 — nine tables' `SELECT` policies don't check `is_active`,** narrowing exactly the protection
  H15 already built for two tables to those two tables only.
- **H25 — the personal entries fetch has no explicit bound,** trusting an implicit PostgREST default
  instead of a decision this app actually made, the same category of gap H10 already cost effort to
  close once.
- **M34 — `timesheets.week_start` isn't constrained or normalized to Monday**, relying entirely on
  every UI call path already passing an aligned date rather than the database enforcing it.
- **M35 — `time_entries.tag_ids` accumulates dangling UUIDs on tag deletion** with no cleanup path
  and no admin visibility into the accumulation.
- **M36 — `time_entries.entry_date` has no server-side relationship to `start_time` or the entry
  owner's timezone**, for a team this app's own `timezones` list confirms is genuinely distributed
  across them.

### 35. Final Roadmap

**Before launch:**
- ~~Confirm (via real Supabase project access) that every migration under `supabase/migrations/` —
  especially `20260814000000` and `20260814010000` — has actually reached production (H23).~~
  **Done 2026-08-14** — verified directly against the Supabase dashboard; both migrations are live.
  The remaining piece of H23 (no CI/automated deployment check, so this was a one-time manual
  verification rather than a fixed process) is a lower-stakes follow-up, not a launch blocker.
- Execute the historical-data import (H18): the tool exists
  (`scripts/import-clockify-history.mjs`) and is validated against a real export — get the
  service-role key, the full historical CSV (not just the one-week sample used to build/test it),
  run it in dry-run mode first to review the unmatched-users/unmatched-projects report, fix any
  mapping gaps, then `--commit`. Delete the script once done, per its own header comment. **Still
  the one item on this list that isn't done** — everything else below was implemented 2026-08-14.
- ~~Add a `.limit()`/pagination bound to the personal entries fetch (H25)~~ **Done 2026-08-14** —
  `entriesQ` now caps at 5000 rows.
- ~~Fix `resendInvite()`'s pagination (H26)~~ **Done 2026-08-14** — looks the account up by email in
  `profiles` directly instead of paging through `listUsers()`.
- ~~Extend `is_active_user()` to the remaining nine `SELECT` policies (H24)~~ **Done 2026-08-14** —
  `20260814020000_extend_is_active_to_read_policies.sql`.
- ~~Decide the fate of the three dead Manage tabs (M42)~~ **Done 2026-08-14** — removed from
  `manage.tsx`.
- Make a call on M29 (notifications): even just "timesheet submitted for your review" via email
  closes the biggest real gap; if that's not feasible for launch, that's an acceptable v1 scope cut,
  but it should be a decision, not an oversight. **Not implemented this pass** — a product decision
  (which channel, whose inbox) rather than a mechanical fix, left for the team to make.
- ~~Add a `key` prop to the deep-linked `<TeamEntriesTab>` in `ManagePage` (L38)~~
  **Done 2026-08-14.**
- ~~Row-lock (or advisory-lock) `submit_timesheet()`'s running-timer check against its own commit
  (H20)~~ **Done 2026-08-14** — `20260814030000_atomic_submit_timesheet_lock.sql`.

**After launch (soon, not day one):** — **all done 2026-08-25**, see each finding's own entry above.
- ~~H16 (Detailed report) and H17 (cost/billing report)~~ **Done.**
- ~~M26, M27, M28 — per-entry billable override, project budgets, billable/non-billable Reports
  split.~~ **Done.**
- ~~H21 — make the multi-day timer split one transaction.~~ **Done** —
  `20260825010000_atomic_stop_timer.sql`.
- ~~M34, M35, M36 — the three remaining data-integrity hardening items from the Database audit.~~
  **Done.**
- ~~M44 — search/filter/pagination on the Projects tab.~~ **Done — turned out to already be shipped
  by an earlier commit (`c155050`) whose status this document simply never caught up to; corrected
  here rather than treated as new work.**
- ~~L34 — profile-bootstrap error handling.~~ **Done.**
- ~~M41 — bound `timesheetsQ`, index `activity_log`.~~ **Done.**

**Future / optional:**
- M24 — a real (minimal) time-off workflow, or a decision to remove the page entirely — a product
  call, not an engineering one. **Still open.**
- M25 — project-scoped task categories, only if task lists genuinely differ per project in practice
  (worth confirming with the team before building anything). **Still open.**
- ~~L37 (`typecheck` script), L39 (empty project-picker messaging), L40 (Timesheet Grid empty
  rows)~~ **Done 2026-08-25.** L31 (avatar upload) and L32 (structured weekly schedule) remain
  open — L32's UX half was separately addressed by prior commits (a real day/time-picker replaced
  the free-text box), but the underlying `weekly_schedule` column is still a plain string; not
  restructured to per-weekday columns, per this finding's own "not worth it unless something
  downstream needs to compute against it" caveat, which still holds — nothing does yet.
- M43 — investment in automated testing, scoped to the highest-stakes business logic first. **Still
  open** — the one item from both Top 10 lists this pass didn't touch.
- Everything listed under "Features We Should NOT Build" above — revisit only if a real, named need
  emerges, not preemptively.

### 36. Final Status Summary

**This section is a snapshot from 2026-08-14 — left as-is below as a historical record. See the
"Same-Day Implementation Pass (2026-08-25)" section at the very end of this document for what's
changed since, including one correction this snapshot needs: C4 (below, listed as fixed) was
deliberately reverted on 2026-08-19 — see C4's own entry near the top of this document.**

- **Critical (C1–C7):** all fixed in the committed codebase **and now confirmed live** — C6/C7's
  migrations were verified directly against the Supabase dashboard on 2026-08-14 (H23). The
  "fixed in the repo" vs. "fixed in production" gap this document couldn't previously close on its
  own is resolved for these two; the systemic process gap (no CI to catch this automatically next
  time) remains, tracked as the residual part of H23.
- **High:** H6–H15, H19, H22 all confirmed fixed and still accurate. H16–H17 (reporting gaps) remain
  open from prior passes; **H18 (data import) is now ⚠️ Improved** — the import tool is built and
  validated against a real export, the actual cutover run against production hasn't happened yet.
  H20–H21 (two narrow-window race conditions) remain open. **Four new
  High findings this pass:** H23 (deployment verification — **now ⚠️ Improved**, see above: the
  specific C6/C7-live risk is confirmed closed, the systemic no-CI gap remains), H24 (is_active
  read-access gap on nine tables), H25 (unbounded personal entries fetch), H26 (`resendInvite`
  pagination bug at the workspace's own stated scale).
- **Medium:** M13–M23, M30–M33 all confirmed fixed. M18 remains intentionally partial (visibility,
  not auto-stop, by product decision) and M23 remains a deliberate "flag, don't force" design.
  M24–M29 (parity gaps) and M34–M36 (data-integrity hardening) remain open. **Four new Medium
  findings:** M41 (unbounded `timesheetsQ` + missing `activity_log` index), M42 (three dead
  placeholder tabs, recommended for removal once already, still present), M43 (no automated tests),
  M44 (Projects tab has no search/filter/pagination, the same gap M39 just fixed for member-heavy
  surfaces but on a different data model).
- **Low:** L20–L27, L33 all confirmed fixed. **L30 status corrected** from `⏳ Open` to `✅ Fixed`
  (superseded by M33 — its own marker was simply never updated). L31, L32, L34 remain open. **Four
  new Low findings:** L37 (`typecheck` script), L38 (a real, narrow remount bug in this session's
  own `/manage` deep-linking work — trivial one-line fix), L39 (no empty-state messaging on an
  empty project picker), L40 (Timesheet Grid shows every project as a row even with zero hours that
  week).
- **Remaining edge cases:** the two genuinely open race conditions (H20, H21) are both narrow-window
  and require near-simultaneous multi-session action from the same person to trigger — real, but
  low-frequency; the timezone/`entry_date` drift (M36) is similarly low-frequency but real for a
  team explicitly spread across timezones; every other edge case this document's five prior passes
  checked (double-clicks, concurrent approvals, orphaned timers, empty-week submission, locked-week
  edits) is confirmed still enforced at both the client and database layer.
- **Overall launch readiness: ⚠️ Almost ready.**

  **Reasoning:** the actual core loop — start a timer or log time manually, submit a week, have a
  manager review and approve it, see it in Reports — is genuinely solid: six audit passes deep, with
  real defense-in-depth (client check *and* database backstop) on every business rule that matters,
  not a prototype wearing a UI. Nothing found in this final pass changes that assessment; if the
  question were only "does the core workflow work correctly," the answer would be ✅ Ready.
  What keeps this at ⚠️ rather than ✅ now that H23's specific risk is resolved: (1) H18's
  historical-data import is built and tested but not yet run against production — "switch tomorrow"
  implies the data has actually moved, not just that a tool exists to move it; (2) three
  genuine day-one product gaps for *this specific business* — entry-level billing backup (H16), a
  cost/billing figure (H17), and any notification delivery at all (M29) — would each generate real
  friction and support questions in week one, even though none of them are bugs; (3) the three dead
  Manage tabs (M42) are a small but real, easily-fixed first impression problem. None of these are
  ❌-level — nothing here suggests the application is unsafe to use or fundamentally broken — but
  "almost ready, with a short, specific,
  mostly-cheap punch list" is a more honest answer than "ready" given what's still open.

### Files inspected this pass

Every file under `src/routes/` and `src/lib/workspace/`; all 37 files under `supabase/migrations/`
in chronological order; `src/lib/admin.functions.ts`; `src/integrations/supabase/auth-middleware.ts`,
`client.server.ts`; `src/start.ts`; `src/server.ts`; `src/components/entry-form-dialog.tsx`,
`app-shell.tsx`, `member-search-filter.tsx`, `timesheet-grid.tsx`; `package.json`;
`supabase/config.toml`; and this document (`docs/audit-findings.md`) in full, including every prior
audit section, to verify status claims against current code rather than against each other.

---

## Same-Day Implementation Pass (2026-08-14)

Implemented the "Before launch" punch list this Final Product Review left open, minus the historical
Clockify import itself (H18 — requires real service-role credentials and the full export, neither
available in this environment; still a manual cutover step, not more engineering). Six findings
fixed:

- **H20** — `submit_timesheet()`'s running-timer check made atomic against a concurrent timer-start
  via a shared row-lock on the submitting user's `profiles` row, taken by both the function and a new
  `BEFORE INSERT` trigger on `time_entries` (`20260814030000_atomic_submit_timesheet_lock.sql`).
- **H24** — `is_active_user()` extended to the nine previously-bare `USING (true)` SELECT policies
  (`profiles`, `teams`, `team_members`, `clients`, `tags`, `projects`, `project_members`,
  `project_tags`, `workspace_settings`) via
  `20260814020000_extend_is_active_to_read_policies.sql`.
- **H25** — `entriesQ` (`use-time-entries.ts`) now carries an explicit `.limit(5000)` instead of
  relying on PostgREST's implicit default cap.
- **H26** — `resendInvite()` (`admin.functions.ts`) now looks the account up by email directly
  against `profiles` instead of paging through `listUsers()`.
- **M42** — the three dead "coming soon" Manage tabs (Expenses, Kiosks, Invoices) removed from
  `manage.tsx`, along with their now-unreferenced icon imports and the generic fallback `<Card>`
  branch that only they ever rendered; the route's `head()` meta description updated to match.
- **L38** — `<TeamEntriesTab>` in `ManagePage` now keyed on the deep-link target, forcing a clean
  remount on a second consecutive "Edit entries" link instead of silently keeping the first target's
  state.

Verified with `npx tsc --noEmit` (clean) and `npm run build` (clean production build); `npm run lint`
was not usable as a signal here — the whole repo's non-LF line endings make ESLint's
`prettier/prettier` rule fail on effectively every file, unrelated to this change, so lint output was
spot-checked against only the touched files with that rule filtered out, and came back clean. No
browser session — same caveat as every prior pass, this repo has no linked Supabase credentials in
this environment.

Two migrations, `20260814020000` and `20260814030000`, are now committed but **not yet verified
live** the way `20260814000000`/`20260814010000` were for H23 — that verification is a repeat of the
same five-minute dashboard check, not done as part of this pass.

Still open from the "Before launch" list: **H18** (execute the actual import) and **M29**
(notifications — a product decision on channel/ownership, not a mechanical fix).

---

## Same-Day Implementation Pass (2026-08-25)

Eleven days after the 2026-08-14 pass above, this session re-read the full document, cross-checked
its "still open" claims against the current code (the branch had moved on — 8 commits since,
2026-08-18 through 2026-08-19, none of which had updated this document), then worked through the
genuinely open remainder highest-priority-first. No code was changed in the drift-check itself; the
findings below reflect real implementation work that followed it.

### Drift found before any new work started

- **C4 (overlap validation) was deliberately reverted**, not merely regressed. Commit `df512c1`
  ("Allow timer-less starts, overlapping entries, and add a searchable client filter," 2026-08-19)
  dropped the `EXCLUDE` constraint and its client-side pre-check entirely, "matching Clockify." This
  document's own section 1 table still called it "✅ Fixed" until this pass — a real accuracy gap,
  now corrected at C4's own entry. Not re-litigated or reversed back here: it reads as an
  intentional product call the team made, not an oversight to fix.
- **Two real bugs were fixed in the same commit window with no corresponding audit entry at all:**
  commit `6fabeaa` ("Fix stuck-forever timers by letting a running entry's start time be corrected")
  addressed a real recovery gap — a multi-day split whose later-day insert collided with the (then
  still-present) overlap constraint left the timer stuck running with no way to fix it, since editing
  or deleting a running entry was blocked everywhere; and commit `4b3823c` ("Fix a running timer's
  typed-in description not being saved on stop") fixed `stopTimer` silently discarding whatever
  description was typed while the timer ran. Neither needed further work this pass — noted here so
  the document's own history stays complete, not because either was reopened.
- **M44 (Projects tab search/filter/pagination)** turned out to already be shipped by commit
  `c155050` (2026-08-18) — this document's own marker was simply never updated, the same class of
  drift L30 already corrected once. Verified directly against the current file rather than assumed.

### Findings fixed this pass, highest priority first

Ranked by the same "genuinely open, highest impact first" ordering the document's own Top 10 lists
already established — H18 and M29 skipped as not actionable from this environment (H18 needs real
service-role credentials and the full export; M29 needs a product decision on channel/ownership),
M24 skipped as a product decision, not an engineering task:

- **H16** — entry-level Detailed report: new Reports tab, `detailedEntriesForRange()` client query
  (no new RPC — `time_entries`' own RLS already scopes it correctly), search/project/employee
  filters, pagination, CSV export.
- **H17** — cost/billing ($) report: new `employee_billable_hours_range` RPC, Amount column on
  Reports' employee view.
- **H21** — atomic multi-day timer split: new `stop_timer()` `SECURITY DEFINER` RPC
  (`20260825010000_atomic_stop_timer.sql`) replacing the old insert-loop-then-update sequence.
- **M26** — per-entry billable override: `EntryFormDialog` billable checkbox.
- **M28** — billable/non-billable split in Reports: new `project_billable_hours_range` RPC, Billable
  column on both tabs.
- **M27** — project-level budget/estimated-hours: new `budget_hours` column, `useProjectBudgets()`,
  over/near-budget badges on project cards.
- **M34** — `timesheets.week_start` normalized to Monday inside `submit_timesheet()`.
- **M35** — `delete_tag()` RPC strips dangling `tag_ids` atomically with the tag delete.
- **M36** — `entry_date` now derived server-side from `start_time` + the entry owner's
  `profiles.timezone` via a new trigger.
- **M41** — `timesheetsQ` bounded to the same rolling window `entries` already uses;
  `activity_log_created_at_idx` added.
- **M44** — confirmed already fixed (see drift note above), not duplicated.
- **L34** — profile-bootstrap insert now surfaces a real failure instead of swallowing it.
- **L37** — `npm run typecheck` added, and documented in `CLAUDE.md`.
- **L39** — empty-state messaging on the TimerBar/EntryFormDialog project pickers.
- **L40** — "hide empty rows" toggle on the Timesheet Grid.

Eight new migrations: `20260825000000_employee_billable_hours_range.sql`,
`20260825010000_atomic_stop_timer.sql`, `20260825020000_project_billable_hours_range.sql`,
`20260825030000_project_budget_hours.sql`, `20260825040000_normalize_submit_timesheet_week_start.sql`,
`20260825050000_delete_tag_cleans_up_entries.sql`, `20260825060000_derive_entry_date_from_timezone.sql`,
`20260825070000_activity_log_created_at_index.sql`. Committed as `055c10b` on
`claude/timer-stop-issues-1hj575`.

**Not done this pass, by explicit scope decision, not oversight:**
- **L31** (avatar upload) and **L32** (structured weekly-schedule storage) remain open — see each
  finding's own entry / the roadmap above for why.
- **M43** (automated tests) remains open — the one item from both prior Top 10 lists this pass didn't
  touch.
- Client subscription-hours-remaining (H17) and the new project-budget status (M27) were both
  deliberately *not* added to Reports — both are all-time figures, not date-ranged, and would sit
  oddly in an otherwise entirely date-ranged page. Consistent scope call across both findings, not
  two different answers to the same question.

### Verification

`npx tsc --noEmit` and `npm run build` both clean after every individual change (not just once at
the end). `npx eslint` run against every touched file after each change, filtered for the
`prettier/prettier` noise this document's prior passes already established as unrelated repo-wide
CRLF noise — clean aside from that and pre-existing `react-refresh/only-export-components` warnings
on `workspace-store.tsx` (a file that was already exporting both components and constants/hooks
before this pass, not a new problem introduced here).

**Not done, same as every prior pass:** no live database access in this environment (the `.env` here
only carries the anon/publishable key, not a service-role key or DB password), so **none of the
eight new migrations have been run against the real Supabase project.** `H21`'s `stop_timer()` RPC
is flagged specifically — it's the most structurally complex migration added this session (a
`plpgsql` loop, `WITH ORDINALITY`, explicit row locking), meaningfully more so than the plain-SQL
functions elsewhere in this pass, and is the one most worth a real syntax/behavior check before
relying on it. No browser session either — no Chrome tooling available and no login credentials for
this app, so nothing here has been visually confirmed working in an actual browser. This is the same
standing gap H23 already named for this document's entire history: a migration file existing and
that migration having actually run against production are two different facts, and nothing in this
environment can close that gap on its own.

### Updated launch-readiness read

The "Overall launch readiness: ⚠️ Almost ready" call in section 36 (2026-08-14) named three specific
reasons: H18 not yet run, H16/H17/M29 as day-one product gaps, and the three dead Manage tabs (M42).
M42 was fixed the same day it was named. H16 and H17 are now fixed by this pass. That leaves the
same two items this document has been circling for two passes: **H18 (execute the real import)** and
**M29 (notification delivery)** — both explicitly out of this pass's reach (credentials/export for
one, a product decision for the other), not because they're hard, but because they're not
engineering-shaped tasks answerable from inside this repo. Nothing else found this pass suggests the
core timer/timesheet/approval loop is anything other than what six prior passes already
established: solid, defense-in-depth, not a prototype. The honest read is the same "almost ready"
shape as before, narrowed to fewer, more specific, non-code blockers than it had two passes ago.
