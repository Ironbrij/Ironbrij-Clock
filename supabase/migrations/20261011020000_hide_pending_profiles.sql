-- Product decision 2026-10-11: people still awaiting approval shouldn't
-- appear to anyone but admins (who approve them) until they're approved.
-- profiles_select_all (20261011010000) let any approved account read every
-- profile, pending ones included, so a not-yet-vetted signup showed up in
-- the Team roster and member pickers for everybody.
--
-- Now: your own row (while active), every approved account's row, and —
-- for admins only — pending rows too. Managers don't approve accounts
-- (approve_member is admin-only), so they don't see pending people either.
-- has_role() already ignores pending/inactive callers (20261011010000).
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated
  USING (
    (id = auth.uid() AND public.is_active_user(auth.uid()))
    OR (
      public.is_approved(auth.uid())
      AND (NOT is_pending OR public.has_role(auth.uid(), 'admin'))
    )
  );
