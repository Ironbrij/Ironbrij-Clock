-- Activity log for the Manage → Activity tab. Append-only: no INSERT/UPDATE/
-- DELETE grant to authenticated at all — the only way a row gets written is
-- through the SECURITY DEFINER functions and trigger below, which already
-- run as trusted, elevated code. Visibility mirrors the same pattern used
-- everywhere else in this app: admins see everything, managers see activity
-- involving people they share a team with, nobody else sees anything.
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select" ON public.activity_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.has_role(auth.uid(), 'manager')
      AND (target_user_id IS NULL OR public.shares_team(auth.uid(), target_user_id))
    )
  );

-- ============ approve_member: now also logs the approval ============
CREATE OR REPLACE FUNCTION public.approve_member(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can approve members';
  END IF;

  IF auth.uid() = _user_id THEN
    RAISE EXCEPTION 'You cannot approve your own account.';
  END IF;

  UPDATE public.profiles
  SET is_pending = false
  WHERE id = _user_id;

  INSERT INTO public.activity_log (actor_id, action, target_user_id)
  VALUES (auth.uid(), 'member_approved', _user_id);
END;
$$;

-- ============ set_member_role: now also logs old → new role ============
CREATE OR REPLACE FUNCTION public.set_member_role(_user_id uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old_role public.app_role;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  SELECT role INTO _old_role FROM public.profiles WHERE id = _user_id;

  UPDATE public.profiles SET role = _role WHERE id = _user_id;

  INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
  VALUES (
    auth.uid(),
    'role_changed',
    _user_id,
    jsonb_build_object('old_role', _old_role, 'new_role', _role)
  );
END;
$$;

-- ============ submit_timesheet: now also logs the submission ============
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

-- ============ review_timesheet: now also logs approve/reject ============
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

-- ============ team_members: logged via trigger, not a wrapper function ============
-- addMemberToTeam/removeMemberFromTeam are plain client-side upsert/delete
-- calls, not RPCs — a trigger is the least invasive way to log these without
-- rewriting working code. auth.uid() is available inside a trigger the same
-- way it is inside any other function in this session.
CREATE OR REPLACE FUNCTION public.log_team_membership_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
    VALUES (auth.uid(), 'team_added', NEW.user_id, jsonb_build_object('team_id', NEW.team_id));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
    VALUES (auth.uid(), 'team_removed', OLD.user_id, jsonb_build_object('team_id', OLD.team_id));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER team_membership_activity_log
AFTER INSERT OR DELETE ON public.team_members
FOR EACH ROW EXECUTE FUNCTION public.log_team_membership_change();
