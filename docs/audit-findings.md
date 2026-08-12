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
