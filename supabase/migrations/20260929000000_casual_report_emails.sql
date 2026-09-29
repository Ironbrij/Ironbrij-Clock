-- M52: email a client their own Casual Service Productivity Report for a
-- week. Asked for as "able to send email to clients about clients' Casual
-- Service Productivity Report to be sent out Weekly".
--
-- Manual, like M47's timesheet reminder and for the same reason, plus a
-- stronger one: this leaves the building. Nothing here sends on a schedule
-- (there is no pg_cron or pg_net installed on this project — checked
-- 2026-09-29) and an email exists because a manager previewed it and clicked
-- Send. "Weekly" is a cadence a person follows, not an automation.
--
-- Two functions, deliberately split:
--
--   * casual_report_for_client() is STABLE and composes the report. The
--     preview and the real send both call it, so what the manager reads on
--     screen is the same payload that gets mailed — a preview built from a
--     separate client-side calculation could drift from the sent article.
--   * record_casual_report_email() writes the audit row, and is called only
--     *after* SendGrid has accepted the message.
--
-- That ordering is the opposite of request_timesheet_reminder()'s, on
-- purpose. That one records first because its unique index doubles as a rate
-- limit, and mailing staff twice is worse than mailing them zero times. There
-- is no rate limit here: a report can legitimately need re-sending (a
-- corrected entry, a bounced address), so this log is a record of what
-- actually went out. The UI shows previous sends for the week and makes the
-- operator confirm a repeat, rather than the database refusing one.

-- The rounding rule, mirrored from src/lib/casual-billing.ts.
--
-- Duplicating it in SQL is the deliberate choice. The alternative — passing
-- hours computed in the browser to something that emails them out — would let
-- a client-side bug, or a tampered request, decide what a client is told.
-- The rule is one CASE expression and, since M52, applies to exactly one
-- category, so the mirror is small enough to keep honest.
--
-- 20260903010000_casual_service_reports.sql explains why the report *rollup*
-- isn't a SQL aggregate: rounding has to happen per line, before summing.
-- That still holds, and is why this is a scalar function applied per entry
-- row with the sum taken afterwards — never a SUM() that is then rounded.
--
-- The tolerance is the same guard casual-billing.ts documents. numeric is
-- exact decimal, but seconds/3600 still terminates as a rounded quotient
-- (100 minutes -> 1.66666666666666666667), and multiplying that by 1.2 lands
-- a hair above an exact increment boundary, which ceil() would bill as a
-- whole extra step. One second of genuine overrun is 0.00028h, far above the
-- tolerance, so real work can't be swallowed by it.
CREATE OR REPLACE FUNCTION public.casual_billed_hours(
  _seconds integer,
  _category public.casual_service_category,
  _uplift_pct numeric,
  _increment_hours numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- M52: Paid Casual Service is the only category that is uplifted and
    -- rounded up. VIP Client, Promotional, Ironbrij and every non-casual
    -- entry bill at exact tracked hours.
    WHEN _category IS DISTINCT FROM 'paid_casual'::public.casual_service_category
      THEN COALESCE(_seconds, 0) / 3600.0
    WHEN COALESCE(_increment_hours, 0) <= 0
      THEN COALESCE(_seconds, 0) / 3600.0 * (1 + COALESCE(_uplift_pct, 0) / 100.0)
    ELSE GREATEST(
      0,
      ceil(
        (COALESCE(_seconds, 0) / 3600.0 * (1 + COALESCE(_uplift_pct, 0) / 100.0))
          / _increment_hours - 0.000000001
      )
    ) * _increment_hours
  END;
$$;
REVOKE ALL ON FUNCTION public.casual_billed_hours(integer, public.casual_service_category, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.casual_billed_hours(integer, public.casual_service_category, numeric, numeric) TO authenticated;

-- What went out, to whom, and who sent it. Append-only from the app's point
-- of view — the same shape as activity_log and timesheet_reminders: SELECT
-- only for authenticated, and the sole writer is the SECURITY DEFINER
-- function below.
CREATE TABLE IF NOT EXISTS public.casual_report_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  recipient_email text NOT NULL,
  -- Denormalised on purpose: this records what the client was told, which
  -- must not change when an entry is edited or deleted afterwards.
  line_count integer NOT NULL DEFAULT 0,
  billed_hours numeric NOT NULL DEFAULT 0,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS casual_report_emails_client_week
  ON public.casual_report_emails (client_id, week_start);

GRANT SELECT ON public.casual_report_emails TO authenticated;
GRANT ALL ON public.casual_report_emails TO service_role;
ALTER TABLE public.casual_report_emails ENABLE ROW LEVEL SECURITY;

-- Managers and admins, not scoped by team: a client isn't a team member, and
-- every manager who can reach the Casual Service tab can already see the
-- entries this summarises.
DROP POLICY IF EXISTS "casual_report_emails_select" ON public.casual_report_emails;
CREATE POLICY "casual_report_emails_select" ON public.casual_report_emails FOR SELECT TO authenticated
  USING (public.can_manage(auth.uid()));

-- Composes one client's report for one week — recipient, totals and lines —
-- as a single row.
--
-- Returns the recipient's address as a column rather than letting the caller
-- supply it, the same reasoning request_timesheet_reminder() gives: the
-- caller only ever names a client and a week, never a string that ends up in
-- an email header.
--
-- Every refusal raises with a specific message, so the manager sees the real
-- reason rather than an empty dialog.
CREATE OR REPLACE FUNCTION public.casual_report_for_client(_client_id uuid, _week_start date)
RETURNS TABLE (
  client_name text,
  contact_name text,
  recipient_email text,
  week_start date,
  billed_hours numeric,
  line_count integer,
  lines jsonb,
  previous_sends jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _name text;
  _contact text;
  _email text;
  _uplift numeric;
  _increment numeric;
  _hours numeric;
  _count integer;
  _lines jsonb;
  _previous jsonb;
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and admins can send a client report.';
  END IF;

  -- Monday-start weeks everywhere in this app (see startOfWeek() in
  -- src/lib/time-utils.ts). A misaligned date would report a window that
  -- matches no week anyone else is looking at.
  IF EXTRACT(ISODOW FROM _week_start) <> 1 THEN
    RAISE EXCEPTION 'Week start must be a Monday.';
  END IF;

  IF _week_start > CURRENT_DATE THEN
    RAISE EXCEPTION 'That week has not started yet.';
  END IF;

  SELECT c.name, c.contact_name, btrim(COALESCE(c.contact_email, ''))
    INTO _name, _contact, _email
  FROM public.clients c
  WHERE c.id = _client_id;

  IF _name IS NULL THEN
    RAISE EXCEPTION 'That client no longer exists.';
  END IF;

  IF _email = '' THEN
    RAISE EXCEPTION 'No contact email on file for %. Add one under Manage, Clients first.', _name;
  END IF;

  SELECT ws.client_billing_uplift_pct, ws.casual_billing_increment_hours
    INTO _uplift, _increment
  FROM public.workspace_settings ws
  LIMIT 1;

  WITH report_lines AS (
    SELECT
      te.entry_date,
      COALESCE(NULLIF(btrim(p.full_name), ''), 'Ironbrij') AS va_name,
      COALESCE(NULLIF(btrim(te.task), ''), 'Work') AS task,
      COALESCE(btrim(te.description), '') AS description,
      public.casual_billed_hours(
        te.duration_seconds, te.service_category, COALESCE(_uplift, 0), COALESCE(_increment, 0)
      ) AS hours
    FROM public.time_entries te
    JOIN public.projects pr ON pr.id = te.project_id
    LEFT JOIN public.profiles p ON p.id = te.user_id
    WHERE pr.client_id = _client_id
      AND te.entry_date >= _week_start
      AND te.entry_date < _week_start + 7
      -- Casual-programme work only, and never Ironbrij's own internal
      -- category — the same "what may a client see" rule Reports' own
      -- client-facing view applies (isInternalWork in src/routes/reports.tsx).
      AND te.service_category IS NOT NULL
      AND te.service_category <> 'ironbrij'
      -- A running timer has no duration yet. Telling a client it was 0.00h is
      -- worse than leaving it for the following week's send.
      AND te.end_time IS NOT NULL
  )
  SELECT
    COALESCE(sum(l.hours), 0),
    count(*)::integer,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', l.entry_date,
          'va', l.va_name,
          'task', l.task,
          'description', l.description,
          'hours', round(l.hours, 2)
        )
        ORDER BY l.entry_date, l.va_name, l.task
      ),
      '[]'::jsonb
    )
  INTO _hours, _count, _lines
  FROM report_lines l;

  IF _count = 0 THEN
    RAISE EXCEPTION 'No casual service work is logged for % in that week.', _name;
  END IF;

  -- Anything already sent for this client and week, so the preview can warn
  -- that Send would be a second email. Returned from here rather than read
  -- from the table by the browser: it keeps casual_report_emails out of the
  -- client's query surface entirely, and the warning is only ever needed at
  -- the moment a preview is composed.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'sent_at', e.sent_at,
        'recipient', e.recipient_email,
        'sent_by', COALESCE(NULLIF(btrim(p.full_name), ''), 'someone'),
        'billed_hours', e.billed_hours
      )
      ORDER BY e.sent_at DESC
    ),
    '[]'::jsonb
  )
  INTO _previous
  FROM public.casual_report_emails e
  LEFT JOIN public.profiles p ON p.id = e.sent_by
  WHERE e.client_id = _client_id AND e.week_start = _week_start;

  RETURN QUERY
  SELECT _name, _contact, _email, _week_start, round(_hours, 2), _count, _lines, _previous;
END;
$$;
REVOKE ALL ON FUNCTION public.casual_report_for_client(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.casual_report_for_client(uuid, date) TO authenticated;

-- Records a send that has already happened. Called by the edge function once
-- SendGrid has accepted the message, never by the browser.
CREATE OR REPLACE FUNCTION public.record_casual_report_email(
  _client_id uuid,
  _week_start date,
  _recipient text,
  _line_count integer,
  _billed_hours numeric
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id uuid;
  _name text;
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and admins can send a client report.';
  END IF;

  SELECT c.name INTO _name FROM public.clients c WHERE c.id = _client_id;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'That client no longer exists.';
  END IF;

  INSERT INTO public.casual_report_emails
    (client_id, week_start, recipient_email, line_count, billed_hours, sent_by)
  VALUES (_client_id, _week_start, _recipient, _line_count, _billed_hours, auth.uid())
  RETURNING id INTO _id;

  -- target_user_id stays null: the recipient is a client, not a member of
  -- this workspace. Manage, Activity renders this action from metadata.
  INSERT INTO public.activity_log (actor_id, action, metadata)
  VALUES (
    auth.uid(),
    'casual_report_emailed',
    jsonb_build_object(
      'client_id', _client_id,
      'client_name', _name,
      'week_start', _week_start,
      'recipient', _recipient,
      'line_count', _line_count,
      'billed_hours', _billed_hours
    )
  );

  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_casual_report_email(uuid, date, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_casual_report_email(uuid, date, text, integer, numeric) TO authenticated;
