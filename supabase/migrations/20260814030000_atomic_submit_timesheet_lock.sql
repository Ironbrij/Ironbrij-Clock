-- Final Product Review H20: submit_timesheet()'s running-timer check
-- (20260812070000) and its own submit/lock write aren't atomic under
-- READ COMMITTED (Postgres's default). A second tab/device can INSERT a new
-- running time_entries row for the same week in the exact window between
-- submit_timesheet()'s SELECT ... _has_running check and its own UPDATE of
-- timesheets.status — the new row's INSERT is evaluated against the
-- not-yet-committed (still 'draft'/'rejected') week, so week_is_locked()
-- correctly-but-unluckily allows it, and the timer ends up trapped running
-- inside a now-"submitted" week. Exactly the failure lock_on_submit.sql
-- already went out of its way to prevent once, reintroduced via a race
-- instead of a missing check.
--
-- Fixed by giving both sides of the race a shared lock to serialize on: the
-- submitting user's own profiles row. submit_timesheet() takes it FOR UPDATE
-- up front and holds it for the rest of the call; a BEFORE INSERT trigger on
-- time_entries takes the same lock (on NEW.user_id) whenever a row starts a
-- running timer (end_time IS NULL), before RLS's WITH CHECK (and therefore
-- week_is_locked()) is evaluated against it. Whichever transaction gets there
-- first blocks the other until it commits, so the running-timer check and
-- the submit that depends on it can no longer interleave.
CREATE OR REPLACE FUNCTION public.submit_timesheet(_week_start date)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
  _has_entries boolean;
  _has_running boolean;
BEGIN
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

CREATE OR REPLACE FUNCTION public.lock_user_before_timer_start()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = NEW.user_id FOR UPDATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_user_before_timer_start_trg ON public.time_entries;
CREATE TRIGGER lock_user_before_timer_start_trg
BEFORE INSERT ON public.time_entries
FOR EACH ROW WHEN (NEW.end_time IS NULL)
EXECUTE FUNCTION public.lock_user_before_timer_start();
