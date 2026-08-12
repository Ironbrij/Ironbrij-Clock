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
But both places that surface it filter to `activeMembers` first: `ActiveTimersCard`'s
`relevantActiveTimers` in `src/routes/manage.tsx` (`activeTimers.filter((t) =>
relevantMembers.some((m) => m.id === t.userId))`) and `TeamEntriesTab`'s member picker
(`relevantMembers = activeMembers.filter(...)`) both derive from `members.filter((m) => m.active)`.
Once `removeUserAccess` sets `is_active = false`, that person drops out of `relevantMembers`
entirely, so a manager/admin can no longer even select them in Manage → Entries, let alone see or
stop their still-running timer in the Active Timers card. The row just sits with `end_time = null`
forever — nobody can log in as that user again (their auth account is deleted), and nobody with
access can reach it through the app.

**M21. ⏳ Open.** Manual time entries have no way to represent a shift that crosses midnight.
`EntryFormDialog` (`src/components/entry-form-dialog.tsx`) has a single `date` field applied to
both `startTime` and `endTime` (`toFormValues`, `combineDateAndTime(date, startTime)` /
`combineDateAndTime(date, endTime)` in `createEntry`/`updateEntry`,
`src/lib/workspace/use-time-entries.ts`). Entering e.g. 22:00 as the start and 02:00 as the end
computes an end instant before the start on the same calendar date, so it always hits
`if (minutes <= 0) throw new Error("End time must be after start time.")`. The live timer handles
this correctly via `splitByDay` (H8) when you stop it after midnight, but there is no equivalent
path for someone logging an overnight shift after the fact — "Add manual entry" and Manage →
Entries' edit dialog can only represent it as two separate entries entered on two separate days,
which isn't obvious from the form itself (no hint, no split-add-a-second-entry affordance).

**M22. ⏳ Open.** `submit_timesheet()` has no server-side check that the week being submitted
actually has any entries — only the client's `hasEntries` flag in `SubmissionPanel`
(`src/routes/timesheet.tsx`) stops an empty-week submission. The RPC itself
(`supabase/migrations/20260811040000_lock_on_submit.sql`) only guards against a running timer and
an already-submitted/approved week; nothing stops a direct call to `submit_timesheet` for a week
with zero `time_entries` rows. That week can then sit in — and be approved from — the Approvals
queue as a real, zero-hour "Approved" timesheet. This is the same category of gap H12 closed for
"require descriptions"/"allow manual entry": a business rule enforced only in the client, contrary
to this project's own stated defense-in-depth principle (see `CLAUDE.md`, "Authorization model").

**M23. ⏳ Open.** An admin correcting entries inside an already-approved week (which RLS explicitly
permits — `week_is_locked()`'s admin override) never resets or even flags that week's timesheet
status. `TeamEntriesTab` in `src/routes/manage.tsx` lets an admin edit/delete entries in a locked
week same as any other; nothing calls back into `timesheets` at all. The employee's own
`SubmissionPanel` keeps showing "Approved — this week is locked" with whatever total it originally
had — there's no re-approval step, no "modified after approval" flag, and no notification to the
employee that their signed-off hours changed underneath them. The only trace is a separate
`time_entry_edited`/`time_entry_deleted` row in `activity_log` (from the H11-era trigger), which a
manager would have to go looking for in Manage → Activity to notice — it's disconnected from the
approval itself.

### 9. Low-Priority Issues

**L25. ⏳ Open.** Settings → Users → pending members' "Approve" and "Resend invite" buttons
(`src/routes/settings.tsx`) have no busy/disabled state during their async call — unlike essentially
every other action button in the app (Timer, Submit, Approve/Send back in Manage, entry
Save/Delete), which all set a local `busy` flag before awaiting. A rapid double-click fires two
concurrent RPCs. `approve_member` is a plain idempotent `UPDATE ... SET is_pending = false`, so
double-approving is harmless, but `resendInvite` has no equivalent backstop — each extra click is a
real extra `generateLink` call, so a burst of clicks sends the invitee several magic-link emails.

**L26. ⏳ Open.** `ApprovalsPanel`'s `busyId` (`src/routes/manage.tsx`) is a single shared value
covering the entire pending-approvals list, not per-row. Approving timesheet A sets `busyId = "A"`;
if a manager then acts on a different timesheet B while A is still in flight, `busyId` gets
overwritten to `"B"`, which un-disables A's buttons before A's request has actually resolved — its
`finally` block later calls `setBusyId(null)` unconditionally, regardless of whether a newer action
owns that slot. No data corruption results (`review_timesheet()`'s own `status = 'submitted'` guard
rejects a stale re-click server-side), but the disabled/busy affordance briefly lies about what's
safe to click during concurrent approvals.

**L27. ⏳ Open.** Projects, teams, clients, tags, task categories, members, and employment/schedule
data have no Realtime subscription — only `time_entries` and `timesheets` do (grep
`postgres_changes` under `src/lib/workspace/`: just `use-time-entries.ts` and `use-timesheets.ts`).
An admin renaming/archiving a project, changing a hourly rate, or adding a teammate in one tab
doesn't propagate to another open tab or device until something else triggers a refetch (window
refocus, a route change). `CLAUDE.md` already flags this as something to "consider" for new mutable
tables; it's equally true of several tables that predate that note.

### 10. Edge Cases — This Pass

| Edge case | Status | Note |
|---|---|---|
| Query/network failure surfaced to the user | ✅ Fixed | H13 — global toast on any query error, plus a dedicated error+retry screen for core-shell load failures |
| Submitting the current (unfinished) week | ✅ Fixed | H14 — confirmation dialog explains the lock-out before submitting; not a hard block |
| Removed user's orphaned running timer | ❌ Fail | M20 — invisible in Active Timers and the Manage → Entries picker alike |
| Manual entry across midnight | ❌ Fail | M21 — rejected outright, no split path like the live timer has |
| Empty timesheet submitted via direct API call | ⚠️ Client-only | M22 — UI blocks it, RPC doesn't |
| Editing an approved week's entries (admin) | ⚠️ Partial | M23 — allowed and audit-logged, but status/total go stale with no re-approval |
| Double-clicking Approve/Resend invite (pending members) | ⚠️ Partial | L25 — no busy-state debounce; harmless for Approve, spammy for Resend invite |
| Concurrent actions across two different pending approvals | ⚠️ Partial | L26 — shared `busyId` briefly mis-reports button state; backend still safe |
| Multi-tab drift on projects/teams/clients/members | ⚠️ Partial | L27 — no Realtime; relies on refocus/refetch timing |
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
- **Medium (M20–M23):** all open — an invisible orphaned timer for removed users, a real gap in
  what manual entry can represent, one more client-only business rule in the same family as the
  original H12, and a stale-approval-after-correction gap.
- **Low (L25–L27):** all open — two UI debounce/state gaps around approvals and pending-member
  actions, and a multi-tab staleness gap for the tables that predate this app's Realtime adoption.
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
table above covering both new gaps and confirmed-fixed behavior). **All 3 High findings (H13–H15)
are now fixed**; Medium (M20–M23) and Low (L25–L27) remain open, pending prioritization.
