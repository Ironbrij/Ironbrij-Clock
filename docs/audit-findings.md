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

**M20. ⏳ Open.** A running timer belonging to a member whose access has been removed (or who is
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
