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

## 3. Medium-Priority Issues — open

- **M13.** "Repeat" (↻ on a past entry) bypasses the archived-project guard — it calls `startTimer` directly with the old `projectId` with no archived check, unlike the normal project pickers which filter `!p.archived`. (`time.tsx`)
- **M14.** `updateEntry` has a latent bug for running entries: if a date/start-time patch is ever applied to a running entry (no UI path does this today, but the function is public), `existingEnd` falls back to `existingStart`, forcing `minutes = 0` and throwing the misleading "End time must be after start time." (`use-time-entries.ts`)
- **M15.** Reports' overtime column uses one workspace-wide `weeklyHours` for everyone, ignoring `member_employment.employment_type` (full/part-time) that already exists specifically to distinguish this. Part-time staff get judged against a full-time baseline. (`reports.tsx`)
- **M16.** Deleting a project/client/team is destructive-by-null (orphans historical entries/projects) and irreversible, but none of the confirmation dialogs state how many entries/projects will be affected.
- **M17.** No duplicate-name protection for teams, tags, or task categories (clients alone have a DB `UNIQUE`). Since `task` on a time entry is free text, duplicate task-category names actively collide in the "recent tasks" grouping (`orderByRecencyName`, keyed by name).
- **M18.** Forgotten-clock-out protection is entirely client-side (`setInterval` warning at 4/8/12h) — nothing server-side ever auto-stops or flags an abandoned timer if the tab/browser is closed.
- **M19.** "Approve" fires immediately with no confirmation, while "Send back" (Reject) opens a dialog — inverted risk framing, since Approve is the irreversible one (no "unapprove" exists for non-admins).

---

## 4. Low-Priority Issues — open

- **L20.** No future-dated entry validation — the date input's `max` is a UI hint only; nothing server-side rejects it.
- **L21.** **"Time off" is 100% mock/non-functional** — static sample data, and "Request time off" has no `onClick` at all. There is no real leave/attendance workflow in this codebase. Also decorative/non-functional: Settings → Notifications toggles (no persistence), "Change avatar," and Manage → Expenses/Kiosks/Invoices ("coming soon").
- **L22.** Calendar view (Time page) has no month/week navigation at all — hardcoded to "today," unlike Grid view and the Timesheet page which both have prev/next controls.
- **L23.** Settings → Admin: entering `0` for weekly hours is treated as falsy (`Number(weeklyHours) || settings.weeklyHours`) and silently reverts on save.
- **L24.** `member_employment.hourly_rate` has only client-side non-negative validation; no DB `CHECK` constraint backs it.

---

## 5. Edge Cases — Pass/Fail Against the Original Prompt's List

| Edge case | Status | Note |
|---|---|---|
| Multiple active timers | ✅ Fixed | C3 — unique partial index |
| Overlapping time entries | ✅ Fixed | C4 — EXCLUDE constraint |
| Double clock-in (same tab) | ✅ OK | Button state is server-derived |
| Clocking out without clocking in | ✅ OK | `stopTimer` is a no-op if no matching entry is found |
| Forgotten clock-outs | ⚠️ Weak | M18 — client-only warning, nothing server-side |
| Browser refresh during active timer | ✅ OK | Elapsed time correctly reconstructed from stored `start_time` |
| Browser closing during active timer | ⚠️ Partial | Data is safe, but no warning fires anywhere (ties to M18) |
| Network failure during tracking | ⚠️ Partial | Throws a toast, leaves state as-is (safe default), but no retry/offline queue |
| Switching projects while tracking | ⚠️ By design, unclear | Pickers are `disabled={running}`; not explained to the user why |
| Editing an active timer | ⚠️ Latent bug | Not reachable via current UI, but M14 breaks if ever wired up |
| Deleting an active timer | ✅ Blocked in UI | Delete button hidden while running |
| Working across midnight | ✅ Fixed | H8 — split at day boundaries |
| Editing approved/submitted timesheets | ✅ Fixed | H6 — locked at submission, admin override remains |
| Manager modifying employee records | ✅ Fixed | H11 — Manage → Entries |

---

## 6. Status Summary

- **Critical (C1–C5):** all fixed.
- **High (H6–H12):** all fixed.
- **Medium (M13–M19):** all open.
- **Low (L20–L24):** all open.
