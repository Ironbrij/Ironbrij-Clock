-- ============ timesheet submission + manager approval ============
-- One row per (person, week). Staff move it draft -> submitted; a manager
-- who shares a team with them (or an admin) moves it to approved/rejected.
-- All writes go through the two SECURITY DEFINER functions below rather
-- than direct table grants, so the status can't be edited outside that
-- state machine by either side.

CREATE TYPE public.timesheet_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');

CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status public.timesheet_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX timesheets_user_week_idx ON public.timesheets (user_id, week_start);
CREATE INDEX timesheets_pending_idx ON public.timesheets (status) WHERE status = 'submitted';

-- Read-only via RLS (same self / admin / manager-shares-team shape as
-- time_entries). No direct INSERT/UPDATE/DELETE grant on purpose.
GRANT SELECT ON public.timesheets TO authenticated;
GRANT ALL ON public.timesheets TO service_role;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timesheets_select" ON public.timesheets FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );

-- Staff: create or resubmit their own week. Blocked once it's already
-- submitted or approved, so a resubmit only works after a rejection.
CREATE OR REPLACE FUNCTION public.submit_timesheet(_week_start date)
RETURNS public.timesheets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.timesheets;
BEGIN
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

  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_timesheet(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_timesheet(date) TO authenticated;

-- Manager (of a shared team) or admin: approve or reject a submitted week.
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
BEGIN
  IF _status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Can only approve or reject a submitted timesheet';
  END IF;

  SELECT user_id INTO _owner FROM public.timesheets WHERE id = _timesheet_id AND status = 'submitted';
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Timesheet not found or not awaiting review';
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

  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public.review_timesheet(uuid, public.timesheet_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_timesheet(uuid, public.timesheet_status, text) TO authenticated;

-- ============ lock entries once their week is approved ============
-- Admins can still override (payroll corrections); the entry's own owner
-- and any manager cannot edit/delete inside an approved week.
CREATE OR REPLACE FUNCTION public.week_is_locked(_user_id uuid, _entry_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.timesheets
    WHERE user_id = _user_id
      AND status = 'approved'
      AND _entry_date >= week_start
      AND _entry_date < week_start + 7
  );
$$;
REVOKE ALL ON FUNCTION public.week_is_locked(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.week_is_locked(uuid, date) TO authenticated;

DROP POLICY IF EXISTS "time_entries_update" ON public.time_entries;
CREATE POLICY "time_entries_update" ON public.time_entries FOR UPDATE TO authenticated
  USING (
    (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  );

DROP POLICY IF EXISTS "time_entries_delete" ON public.time_entries;
CREATE POLICY "time_entries_delete" ON public.time_entries FOR DELETE TO authenticated
  USING (
    (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  );
