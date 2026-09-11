-- M47: lets a manager nudge someone who hasn't submitted their timesheet,
-- from the same Manage → Approvals status panel that already tells them
-- who those people are. Until now that panel was read-only: it identified
-- the problem and then sent the manager off to Slack or email to chase it
-- manually, every week.
--
-- Manual only, by design — nothing here sends on a schedule. A reminder
-- exists because a manager clicked Remind on a specific person and week.
--
-- Rate limit: one reminder per person per week, enforced by the unique
-- index below rather than by the UI, because two managers who share a team
-- can both see the same not-submitted row and both decide to chase it. A
-- client-side check couldn't see the other manager's click; this can.
--
-- Deliberate trade-off on ordering: the reminder row is written *before*
-- the email is actually sent (the edge function does the sending, using
-- what this returns). So a SendGrid failure leaves a recorded reminder
-- that never arrived, and the person can't be re-reminded that week
-- without an admin deleting the row. That's the safer failure direction —
-- the alternative (write after send) reopens the double-send race this
-- exists to close, and mailing staff twice is worse than mailing them
-- zero times and having the manager notice the error toast.
CREATE TABLE public.timesheet_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX timesheet_reminders_user_week
  ON public.timesheet_reminders (user_id, week_start);

-- Append-only from the app's point of view, same shape as activity_log:
-- SELECT only, no INSERT/UPDATE/DELETE grant to authenticated at all. The
-- only writer is request_timesheet_reminder() below, which runs as a
-- trusted SECURITY DEFINER.
GRANT SELECT ON public.timesheet_reminders TO authenticated;
GRANT ALL ON public.timesheet_reminders TO service_role;
ALTER TABLE public.timesheet_reminders ENABLE ROW LEVEL SECURITY;

-- Visibility mirrors activity_log exactly: admins see everything, managers
-- see reminders for people they share a team with. A member can also see
-- reminders addressed to them — they're the one being emailed, so there's
-- nothing to hide, and it keeps "were you reminded?" answerable without a
-- manager present.
CREATE POLICY "timesheet_reminders_select" ON public.timesheet_reminders FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
  );

-- Records the reminder and returns who to email. Returns the recipient's
-- address and both display names as columns (rather than letting the edge
-- function take them from the client) for the same reason
-- timesheet_submission_recipients() does: the caller only ever supplies a
-- user id and a week, never a string that ends up in an email body.
--
-- Returns a row only on success; every refusal raises, so the client gets
-- a specific message rather than a silent no-op.
CREATE OR REPLACE FUNCTION public.request_timesheet_reminder(_user_id uuid, _week_start date)
RETURNS TABLE (email text, full_name text, week_start date, manager_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _status text;
  _manager_name text;
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and admins can send reminders';
  END IF;

  IF auth.uid() = _user_id THEN
    RAISE EXCEPTION 'You cannot send yourself a reminder.';
  END IF;

  -- Same visibility rule as pendingApprovals/review_timesheet(): an admin
  -- can reach anyone, a manager only their own team. Without this, any
  -- manager could email any employee in the company.
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.shares_team(auth.uid(), _user_id) THEN
    RAISE EXCEPTION 'You can only remind people on your own team.';
  END IF;

  -- Monday-start weeks everywhere in this app (see startOfWeek() in
  -- src/lib/time-utils.ts) — a misaligned date would quietly create a
  -- second reminder slot for the same real week and defeat the unique index.
  IF EXTRACT(ISODOW FROM _week_start) <> 1 THEN
    RAISE EXCEPTION 'Week start must be a Monday.';
  END IF;

  IF _week_start > CURRENT_DATE THEN
    RAISE EXCEPTION 'That week has not started yet.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id AND p.is_active AND NOT p.is_pending AND p.email IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'That person has no active account to email.';
  END IF;

  -- Nothing to chase if they've already submitted. Draft and rejected both
  -- still need action from them, so both remain remindable.
  SELECT t.status INTO _status
  FROM public.timesheets t
  WHERE t.user_id = _user_id AND t.week_start = _week_start;

  IF _status IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'They have already submitted that week.';
  END IF;

  BEGIN
    INSERT INTO public.timesheet_reminders (user_id, week_start, sent_by)
    VALUES (_user_id, _week_start, auth.uid());
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'They have already been reminded about that week.';
  END;

  SELECT COALESCE(p.full_name, p.email) INTO _manager_name
  FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
  VALUES (auth.uid(), 'timesheet_reminder_sent', _user_id,
          jsonb_build_object('week_start', _week_start));

  RETURN QUERY
  SELECT p.email, p.full_name, _week_start, _manager_name
  FROM public.profiles p WHERE p.id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_timesheet_reminder(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_timesheet_reminder(uuid, date) TO authenticated;
