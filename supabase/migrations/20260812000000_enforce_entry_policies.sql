-- Closes the audit's H12 finding: "Require descriptions on entries" and
-- "Allow manual time entry" (Settings > Admin) were only ever checked in
-- the UI — TimerBar and the manual-entry dialog block the button, but
-- nothing stopped a direct API call (or a future UI path that forgets the
-- check) from bypassing either setting entirely. This adds the same
-- admin-override-shaped enforcement everything else in this table already
-- uses.
--
-- manual_entry_allowed() is scoped to end_time IS NULL on purpose: that's
-- exactly what distinguishes "starting a timer" (INSERT with only
-- start_time set, end_time filled in later by stopTimer) from "adding a
-- complete entry without ever running the timer" (INSERT with both times
-- set already) — the thing this setting is actually meant to restrict, per
-- its own description ("staff can add time without running the timer").
CREATE OR REPLACE FUNCTION public.description_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT require_descriptions FROM public.workspace_settings WHERE id = true), false);
$$;
REVOKE ALL ON FUNCTION public.description_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.description_required() TO authenticated;

CREATE OR REPLACE FUNCTION public.manual_entry_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT allow_manual_entry FROM public.workspace_settings WHERE id = true), true);
$$;
REVOKE ALL ON FUNCTION public.manual_entry_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_entry_allowed() TO authenticated;

-- Note on UPDATE: description_required() applies to every edit's resulting
-- row, not just edits that touch the description field. If descriptions
-- get turned on after entries with a blank one already exist, the first
-- edit to one of those (even an unrelated field like project) will need a
-- description filled in at the same time. That's an accepted tradeoff for
-- keeping the check simple — the app's own updateEntry only raises its
-- client-side version of this when description is actually part of the
-- change, so this only surfaces server-side in that specific overlap.

DROP POLICY IF EXISTS "time_entries_insert" ON public.time_entries;
CREATE POLICY "time_entries_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
    AND (
      public.has_role(auth.uid(), 'admin')
      OR NOT public.description_required()
      OR length(btrim(description)) > 0
    )
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.manual_entry_allowed()
      OR end_time IS NULL
    )
  );

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
    AND (
      public.has_role(auth.uid(), 'admin')
      OR NOT public.description_required()
      OR length(btrim(description)) > 0
    )
  );
