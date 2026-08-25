-- M34: nothing constrained timesheets.week_start to actually be a Monday,
-- the app's own notion of "week" (startOfWeek() in time-utils.ts). Every
-- UI call path already passes an aligned date, so this never happens
-- through normal use — but a direct RPC call with an arbitrary date (e.g.
-- a Wednesday) would key a timesheets row to a 7-day window that straddles
-- two different UI-displayed weeks, since week_is_locked()'s arithmetic
-- (`entry_date >= week_start AND entry_date < week_start + 7`) trusts
-- whatever it's given.
--
-- `authenticated` has no INSERT/UPDATE grant on public.timesheets at all
-- (see 20260804110000_timesheet_approvals.sql) — submit_timesheet() is the
-- only write path, so normalizing here (rather than also adding a table
-- CHECK constraint) closes the gap completely, not just partially. Chose
-- date_trunc('week', ...) — silently correcting to the same Monday the
-- date already falls in — over a hard-rejecting CHECK, matching how the
-- rest of this schema prefers to guide behavior over failing where it
-- reasonably can (Postgres's date_trunc('week', ...) is Monday-based,
-- same as startOfWeek()).
CREATE OR REPLACE FUNCTION public.submit_timesheet(_week_start date)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
  _has_entries boolean;
  _has_running boolean;
BEGIN
  _week_start := date_trunc('week', _week_start)::date;

  PERFORM 1 FROM public.profiles WHERE id = auth.uid() FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.time_entries
    WHERE user_id = auth.uid()
      AND entry_date >= _week_start
      AND entry_date < _week_start + 7
  ) INTO _has_entries;

  IF NOT _has_entries THEN
    RAISE EXCEPTION 'Log some time before submitting this week.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.time_entries
    WHERE user_id = auth.uid()
      AND end_time IS NULL
      AND entry_date >= _week_start
      AND entry_date < _week_start + 7
  ) INTO _has_running;

  IF _has_running THEN
    RAISE EXCEPTION 'Stop your running timer before submitting this week.';
  END IF;

  INSERT INTO public.timesheets (user_id, week_start, status, submitted_at)
  VALUES (auth.uid(), _week_start, 'submitted', now())
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET status = 'submitted', submitted_at = now(),
        reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
    WHERE public.timesheets.status IN ('draft', 'rejected')
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'This week has already been submitted or approved.';
  END IF;

  INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
  VALUES (
    auth.uid(),
    'timesheet_submitted',
    auth.uid(),
    jsonb_build_object('week_start', _week_start)
  );

  RETURN _row;
END;
$$;
