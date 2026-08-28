-- One-time data fix, not a schema change: the Clockify historical import
-- (H18 cutover, 2026-08-25, docs/audit-findings.md) inserted directly into
-- time_entries via a service-role script, bypassing submit_timesheet()/
-- review_timesheet() entirely. Every one of those weeks has logged hours
-- but zero timesheets row, so it shows as perpetually "Not submitted" on
-- each person's Timesheet page and clutters the unsubmitted-past-weeks
-- nudge (H19) with two years of history that predates real app usage.
--
-- Backfills an 'approved' row for every (user, week) that has logged
-- time_entries but no existing timesheets row at all — "no row exists"
-- is the reliable signal that a week predates real submission (any actual
-- app usage, past or present, always has a row, even a 'draft' or
-- 'rejected' one) — restricted to weeks that have already fully ended,
-- so the current in-progress week is never touched. Idempotent: only
-- inserts where nothing exists yet, and ON CONFLICT DO NOTHING guards a
-- re-run against the same UNIQUE (user_id, week_start) constraint.
--
-- Deliberately raw SQL rather than looping submit_timesheet()/
-- review_timesheet() per week — those RPCs are what notify-timesheet-
-- submitted (M29) hooks into; running ~2 years of history through the
-- real submit flow would email every admin/manager once per historical
-- week per person. This bypasses that path entirely on purpose.
INSERT INTO public.timesheets (
  user_id, week_start, status, submitted_at, reviewed_by, reviewed_at, review_note
)
SELECT
  te.user_id,
  te.week_start,
  'approved',
  now(),
  (SELECT id FROM public.profiles WHERE email = 'louis@ironbrij.com.au'),
  now(),
  'Bulk-approved: historical data imported from Clockify (see docs/audit-findings.md, H18).'
FROM (
  SELECT DISTINCT user_id, date_trunc('week', entry_date)::date AS week_start
  FROM public.time_entries
) te
LEFT JOIN public.timesheets t ON t.user_id = te.user_id AND t.week_start = te.week_start
WHERE t.id IS NULL
  AND te.week_start + 7 <= CURRENT_DATE
ON CONFLICT (user_id, week_start) DO NOTHING;
