-- Closes the timesheet-approval counterpart of the hole 20260805080000
-- closed for member approval: review_timesheet() checked "is the caller a
-- manager/admin who shares a team with the owner" but never "are they
-- reviewing themselves." shares_team(x, x) is trivially true for anyone on
-- any team, so a manager (or admin) could submit their own week and then
-- approve or reject it themselves from their own Approvals queue, with no
-- independent review at all. This mirrors approve_member's existing
-- self-block exactly: nobody, regardless of role, can review their own
-- timesheet.
CREATE OR REPLACE FUNCTION public.review_timesheet(
  _timesheet_id uuid,
  _status public.timesheet_status,
  _note text DEFAULT NULL
)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
  _owner uuid;
  _week date;
BEGIN
  IF _status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Can only approve or reject a submitted timesheet';
  END IF;

  SELECT user_id, week_start INTO _owner, _week
  FROM public.timesheets WHERE id = _timesheet_id AND status = 'submitted';
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Timesheet not found or not awaiting review';
  END IF;

  IF auth.uid() = _owner THEN
    RAISE EXCEPTION 'You cannot review your own timesheet.';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), _owner))
  ) THEN
    RAISE EXCEPTION 'Only an admin, or a manager who shares a team with this person, can review this timesheet';
  END IF;

  UPDATE public.timesheets
  SET status = _status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
  WHERE id = _timesheet_id
  RETURNING * INTO _row;

  INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN _status = 'approved' THEN 'timesheet_approved' ELSE 'timesheet_rejected' END,
    _owner,
    jsonb_build_object('week_start', _week, 'note', _note)
  );

  RETURN _row;
END;
$$;
