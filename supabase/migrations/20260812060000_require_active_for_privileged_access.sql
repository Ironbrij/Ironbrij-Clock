-- QA audit H15: profiles.is_active was never checked by any RLS policy,
-- has_role(), or can_manage() — its own migration comment
-- (20260805070000_profiles_is_active.sql) says outright "is_active is
-- purely cosmetic/filtering." Access revocation for a removed member was
-- delegated entirely to supabaseAdmin.auth.admin.deleteUser() in
-- removeUserAccess (admin.functions.ts), which blocks future sign-ins and
-- token refreshes but doesn't retroactively invalidate a still-unexpired
-- access token already held by that browser. Since role is untouched by
-- removal, a removed admin/manager whose token hadn't yet expired kept
-- passing every has_role/can_manage-gated policy exactly as before —
-- including admin-only ones.
--
-- has_role()/can_manage() are, in every single call site across every
-- migration, always invoked as has_role(auth.uid(), ...) / can_manage
-- (auth.uid()) — they represent "is the *caller* currently in this role,"
-- never a check against some other user's role. That makes it safe to
-- fold is_active into their own definition: every policy built on top of
-- them (teams/clients/tags/projects/*_write_manage, settings_write_admin,
-- set_member_role, approve_member, review_timesheet, and the admin/manager
-- branches of every time_entries/timesheets policy) is strengthened for
-- free, with no other file needing to change.
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_active FROM public.profiles WHERE id = _user_id), false);
$$;
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = _role AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin','manager') AND is_active = true
  );
$$;

-- The one shape has_role/can_manage can't cover: the plain "this is your
-- own row" branch (user_id = auth.uid()) on the two payroll-critical
-- tables, which never goes through either function. Wrapping each policy
-- in "is_active_user(auth.uid()) AND (...)" closes that for time_entries
-- and timesheets specifically — the tables this audit's other findings
-- (H14, M20, M23) are already about — without rewriting every policy in
-- the schema in one pass.
DROP POLICY IF EXISTS "time_entries_select" ON public.time_entries;
CREATE POLICY "time_entries_select" ON public.time_entries FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
  );

DROP POLICY IF EXISTS "time_entries_insert" ON public.time_entries;
CREATE POLICY "time_entries_insert" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user(auth.uid())
    AND (
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
    public.is_active_user(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  )
  WITH CHECK (
    public.is_active_user(auth.uid())
    AND (
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

DROP POLICY IF EXISTS "time_entries_delete" ON public.time_entries;
CREATE POLICY "time_entries_delete" ON public.time_entries FOR DELETE TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
    AND (public.has_role(auth.uid(), 'admin') OR NOT public.week_is_locked(user_id, entry_date))
  );

DROP POLICY IF EXISTS "timesheets_select" ON public.timesheets;
CREATE POLICY "timesheets_select" ON public.timesheets FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), user_id))
    )
  );
