-- Product request 2026-10-11: CC other people on a client's casual service
-- report. The addresses are validated, de-duplicated and capped at five by
-- the notify-casual-report edge function before SendGrid sees them; this
-- records who was copied alongside the existing audit row.
--
-- This relaxes one M52 rule on purpose: until now the browser couldn't name
-- any recipient at all (the To address only ever comes from the client
-- record). CC addresses do come from the sender, who must already be a
-- manager or admin. The To address is unchanged and still can't be
-- overridden.
ALTER TABLE public.casual_report_emails
  ADD COLUMN IF NOT EXISTS cc_emails text[] NOT NULL DEFAULT '{}';

-- Replaced rather than overloaded: a second record_casual_report_email with
-- one extra defaulted parameter would make every 5-argument call ambiguous
-- to PostgREST. With _cc defaulted, an edge function deployed before this
-- change still calls the new one correctly.
DROP FUNCTION IF EXISTS public.record_casual_report_email(uuid, date, text, integer, numeric);
CREATE OR REPLACE FUNCTION public.record_casual_report_email(
  _client_id uuid,
  _week_start date,
  _recipient text,
  _line_count integer,
  _billed_hours numeric,
  _cc text[] DEFAULT '{}'
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
  IF cardinality(COALESCE(_cc, '{}')) > 5 THEN
    RAISE EXCEPTION 'A report can be copied to at most five people.';
  END IF;

  SELECT c.name INTO _name FROM public.clients c WHERE c.id = _client_id;
  IF _name IS NULL THEN
    RAISE EXCEPTION 'That client no longer exists.';
  END IF;

  INSERT INTO public.casual_report_emails
    (client_id, week_start, recipient_email, cc_emails, line_count, billed_hours, sent_by)
  VALUES
    (_client_id, _week_start, _recipient, COALESCE(_cc, '{}'), _line_count, _billed_hours, auth.uid())
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
      'cc', to_jsonb(COALESCE(_cc, '{}')),
      'line_count', _line_count,
      'billed_hours', _billed_hours
    )
  );

  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_casual_report_email(uuid, date, text, integer, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_casual_report_email(uuid, date, text, integer, numeric, text[]) TO authenticated;
