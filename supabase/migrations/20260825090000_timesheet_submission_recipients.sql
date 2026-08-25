-- M29: backs the one real notification this audit recommended building
-- first — "a timesheet is waiting on your review" — email, sent from a
-- new edge function (supabase/functions/notify-timesheet-submitted)
-- called client-side right after submitTimesheet() succeeds
-- (use-timesheets.ts). This RPC answers "who should be told," and
-- re-verifies the caller actually owns a *submitted* timesheet with this
-- id before returning anyone — the edge function can't be used to email
-- people about an arbitrary timesheet id someone happens to know.
--
-- Reuses shares_team() rather than reimplementing "does this manager
-- share a team with the submitter" — same visibility rule
-- pendingApprovals/review_timesheet() already use for who's allowed to
-- review a timesheet in the first place, so the recipient list here is
-- exactly "everyone who could actually act on this," not a superset or
-- subset of it.
--
-- week_start and the submitter's own display name are returned as
-- constant columns on every recipient row (denormalized, but row counts
-- here are a handful of reviewers at most) so the edge function never has
-- to trust a client-supplied display string for the email body — the
-- caller only ever provides the timesheet_id itself.
CREATE OR REPLACE FUNCTION public.timesheet_submission_recipients(_timesheet_id uuid)
RETURNS TABLE (email text, full_name text, week_start date, submitter_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _submitter uuid;
  _week_start date;
  _submitter_name text;
BEGIN
  SELECT t.user_id, t.week_start INTO _submitter, _week_start
  FROM public.timesheets t
  WHERE t.id = _timesheet_id AND t.user_id = auth.uid() AND t.status = 'submitted';

  IF _submitter IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(p.full_name, p.email) INTO _submitter_name
  FROM public.profiles p WHERE p.id = _submitter;

  RETURN QUERY
  SELECT p.email, p.full_name, _week_start, _submitter_name
  FROM public.profiles p
  WHERE p.id <> _submitter
    AND p.is_active
    AND NOT p.is_pending
    AND p.email IS NOT NULL
    AND (
      p.role = 'admin'
      OR (p.role = 'manager' AND public.shares_team(p.id, _submitter))
    );
END;
$$;
REVOKE ALL ON FUNCTION public.timesheet_submission_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timesheet_submission_recipients(uuid) TO authenticated;
