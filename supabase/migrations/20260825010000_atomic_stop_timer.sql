-- H21 (docs/audit-findings.md): stopTimer's multi-day split
-- (use-time-entries.ts) was two-plus separate, sequential client-side
-- Supabase calls — INSERT of later-day segments, then UPDATE of the
-- original row — with no transaction tying them together. A failure
-- partway through (network drop, tab close, a locked-week/description
-- rule tripping on one segment but not another) could leave later
-- segments committed while the original entry stayed stuck `running`
-- forever, with no automated recovery.
--
-- Fixed by moving the whole split-and-close operation into one
-- SECURITY DEFINER RPC, mirroring the shape submit_timesheet/
-- review_timesheet already use: every write happens inside this single
-- function call, so a RAISE EXCEPTION at any point rolls back everything
-- already done in the same call, not just the one statement that failed.
--
-- Day-splitting itself is still computed client-side (splitByDay in
-- time-utils.ts, using the browser's own local time — see M36 for the
-- separate, not-fixed-here finding about that not matching the entry
-- owner's stored profiles.timezone) and passed in as `_segments`, so this
-- change doesn't alter *where* day boundaries fall, only how atomically
-- the resulting rows are written.
--
-- Only ever called by the entry's own owner (client only ever calls this
-- on the caller's own running entry — see stopTimer in
-- use-time-entries.ts), so this is scoped to auth.uid() throughout, same
-- as submit_timesheet, rather than replicating time_entries' full
-- self/admin/manager-shares-team visibility.
--
-- Since SECURITY DEFINER bypasses RLS entirely, every rule the bypassed
-- INSERT/UPDATE policies would otherwise have enforced is replicated
-- explicitly below: is_active_user (H15), week_is_locked with the same
-- admin override, description_required, and manual_entry_allowed (which
-- today already applies to a later-day segment insert, since its
-- end_time is set at insert time — replicated as-is, not reconsidered,
-- since changing which rules apply here isn't this fix's job).
CREATE OR REPLACE FUNCTION public.stop_timer(_entry_id uuid, _description text, _segments jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _entry public.time_entries;
  _project_billable boolean;
  _project_tag_ids uuid[];
  _seg jsonb;
  _idx bigint;
  _seg_date date;
  _is_admin boolean;
BEGIN
  IF NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Your account no longer has access.';
  END IF;

  IF _segments IS NULL OR jsonb_array_length(_segments) = 0 THEN
    RAISE EXCEPTION 'Nothing to stop.';
  END IF;

  -- Locks the row so a second concurrent call (a double-click, or two
  -- tabs racing) blocks until the first commits, then cleanly sees
  -- end_time already set — rather than both racing to split the same
  -- timer at once.
  SELECT * INTO _entry FROM public.time_entries
  WHERE id = _entry_id AND user_id = auth.uid()
  FOR UPDATE;

  IF _entry.id IS NULL THEN
    RAISE EXCEPTION 'Entry not found.';
  END IF;
  IF _entry.end_time IS NOT NULL THEN
    RAISE EXCEPTION 'This timer has already been stopped.';
  END IF;

  _is_admin := public.has_role(auth.uid(), 'admin');

  IF NOT _is_admin AND public.description_required() AND length(btrim(_description)) = 0 THEN
    RAISE EXCEPTION 'Add a description first — your admin has made descriptions required.';
  END IF;

  IF _entry.project_id IS NOT NULL THEN
    SELECT is_billable INTO _project_billable
    FROM public.projects WHERE id = _entry.project_id;
    SELECT COALESCE(array_agg(tag_id), ARRAY[]::uuid[]) INTO _project_tag_ids
    FROM public.project_tags WHERE project_id = _entry.project_id;
  ELSE
    _project_billable := true;
    _project_tag_ids := ARRAY[]::uuid[];
  END IF;

  FOR _seg, _idx IN
    SELECT value, ordinality FROM jsonb_array_elements(_segments) WITH ORDINALITY
  LOOP
    _seg_date := (_seg->>'date')::date;

    IF NOT _is_admin AND public.week_is_locked(auth.uid(), _seg_date) THEN
      RAISE EXCEPTION 'This week is locked because it''s been submitted or approved — ask your manager to send it back if you need to make changes.';
    END IF;

    IF _idx = 1 THEN
      -- The original entry just gets closed out — start_time, project,
      -- task, is_billable, and tag_ids were already set correctly when
      -- the timer started (or last corrected), same as before this
      -- change.
      UPDATE public.time_entries
      SET end_time = (_seg->>'end')::timestamptz,
          description = _description
      WHERE id = _entry_id;
    ELSE
      IF NOT _is_admin AND NOT public.manual_entry_allowed() THEN
        RAISE EXCEPTION 'Your admin has turned off manual time entry — use the timer instead.';
      END IF;

      INSERT INTO public.time_entries (
        user_id, project_id, task, description, start_time, end_time, entry_date,
        is_billable, tag_ids
      ) VALUES (
        auth.uid(), _entry.project_id, _entry.task, _description,
        (_seg->>'start')::timestamptz, (_seg->>'end')::timestamptz, _seg_date,
        _project_billable, _project_tag_ids
      );
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.stop_timer(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_timer(uuid, text, jsonb) TO authenticated;
