-- QA audit M22: submit_timesheet() never checked that the week being
-- submitted actually has any time_entries — only the client's `hasEntries`
-- flag (SubmissionPanel, timesheet.tsx) stopped an empty-week submission.
-- A direct call to the RPC could submit (and get approved) a real,
-- zero-hour "Approved" timesheet. Same category of gap H12 already closed
-- for "require descriptions"/"allow manual entry": a business rule
-- enforced only in the client.
CREATE OR REPLACE FUNCTION public.submit_timesheet(_week_start date)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
  _has_entries boolean;
  _has_running boolean;
BEGIN
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
