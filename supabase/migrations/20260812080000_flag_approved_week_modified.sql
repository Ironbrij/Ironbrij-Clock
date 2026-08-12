-- QA audit M23: RLS already lets an admin edit/delete entries inside an
-- approved week (week_is_locked()'s admin override), but nothing ever
-- reflected that back onto the timesheet itself — the employee's own
-- Timesheet page kept showing "Approved — this week is locked" with
-- whatever total it originally had, with no re-approval step and no signal
-- that their signed-off hours changed underneath them. The only trace was
-- a separate time_entry_edited/time_entry_deleted row in activity_log
-- (from the H11-era trigger) a manager would have to go looking for.
--
-- This doesn't re-open the week or force a re-approval (a real product
-- decision this audit isn't making unprompted, same reasoning as M18) —
-- it just makes the staleness visible: a timestamp on the timesheet row,
-- set automatically whenever a completed write touches an entry inside a
-- currently-approved week. Since only an admin can even reach that path
-- (week_is_locked blocks everyone else), this only ever fires for exactly
-- the case M23 describes.
ALTER TABLE public.timesheets ADD COLUMN entries_modified_at timestamptz;

CREATE OR REPLACE FUNCTION public.flag_approved_week_modified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Covers both directions of a date-changing UPDATE (moving an entry out
  -- of, or into, an approved week) as well as plain INSERT/DELETE.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = OLD.user_id
      AND status = 'approved'
      AND OLD.entry_date >= week_start
      AND OLD.entry_date < week_start + 7;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'approved'
      AND NEW.entry_date >= week_start
      AND NEW.entry_date < week_start + 7;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS flag_approved_week_modified_trg ON public.time_entries;
CREATE TRIGGER flag_approved_week_modified_trg
AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.flag_approved_week_modified();

-- review_timesheet() only ever acts on a row currently 'submitted' (see
-- M19: there's still no way to un-approve an approved timesheet, on
-- purpose, unrelated to this fix), so in practice nothing today moves a
-- row out of 'approved' and this NULL-out never fires. It's here anyway
-- as the correct behavior for that transition if one is ever added, same
-- as reviewed_by/reviewed_at/review_note already get reset on resubmit in
-- submit_timesheet() above.
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
  SET status = _status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note,
      entries_modified_at = NULL
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
