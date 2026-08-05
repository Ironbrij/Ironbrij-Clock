-- The lock added in 20260804110000 covered UPDATE and DELETE on
-- time_entries, but not INSERT — meaning a brand-new (backfilled) entry
-- could still be added into an already-approved week. Closes that gap
-- with the same shape (admin override, everyone else blocked).
DROP POLICY IF EXISTS "time_entries_insert" ON public.time_entries;
CREATE POLICY "time_entries_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  );
