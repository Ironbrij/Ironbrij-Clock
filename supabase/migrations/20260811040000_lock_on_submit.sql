-- Closes the audit's "submitted weeks stay fully editable" gap: previously
-- week_is_locked() only fired once a week was *approved*, so between
-- Submit and Approve/Reject the owner could keep adding/editing/deleting
-- entries in that week. What a manager reviews in the Approvals queue (now
-- showing real entries, not just a total — see the earlier migration set)
-- could then silently drift from what was actually submitted. This locks
-- entries the moment a week is submitted, same as approved — the existing
-- time_entries INSERT/UPDATE/DELETE policies already call week_is_locked()
-- with an admin override baked in, so widening what counts as "locked"
-- here is the only change those policies need.
--
-- A rejected week is deliberately NOT locked — week_is_locked() only checks
-- current status, so the moment a manager sends a week back (status flips
-- to 'rejected'), editing reopens automatically with no extra step needed.
CREATE OR REPLACE FUNCTION public.week_is_locked(_user_id uuid, _entry_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.timesheets
    WHERE user_id = _user_id
      AND status IN ('submitted', 'approved')
      AND _entry_date >= week_start
      AND _entry_date < week_start + 7
  );
$$;

-- Locking on submit creates a trap on its own: if someone submits a week
-- while a timer is still running in it (already a known gap — that
-- running entry's time is invisible to the approver since duration_minutes
-- is null), the lock above would then block the UPDATE stopTimer needs to
-- close it out, leaving them stuck with a runaway timer until a manager
-- rejects the week or an admin steps in. Closing the submission path itself
-- is the simplest fix: you can't submit a week with a timer still going.
CREATE OR REPLACE FUNCTION public.submit_timesheet(_week_start date)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
  _has_running boolean;
BEGIN
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
