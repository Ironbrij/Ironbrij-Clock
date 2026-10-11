-- System review 2026-10-11: "pending" (awaiting admin approval) was enforced
-- only by the UI. 20260805030000_tighten_pending_visibility.sql made the
-- directory tables approval-only, but 20260814020000 then rewrote those same
-- policies to is_active_user() and the approval check was lost. Since then
-- an account nobody has approved yet — an uninvited company-domain signup,
-- say — could read the staff directory, teams, clients and projects straight
-- through PostgREST. A pending account that was *invited* as admin or
-- manager was worse off still: has_role()/can_manage() never looked at
-- is_pending, so it could read payroll before anyone approved it.
--
-- AppShell already blocks every pending account, admins included, so no
-- account in use today is pending; this makes the database agree with it.
--
-- What a pending account can still read: its own profiles row (the
-- "Awaiting approval" screen needs it), workspace_settings (company
-- name/logo on that screen) and its own time entries/timesheets, which were
-- never anyone else's data.

-- ============ helpers ============
-- is_approved() now also requires is_active, so a removed member counts as
-- not approved, matching is_active_user(). Its one existing caller,
-- task_categories_select_all, only gets stricter.
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT is_active AND NOT is_pending FROM public.profiles WHERE id = _user_id),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated;

-- Same shape as 20260812060000's versions, plus NOT is_pending. Every call
-- site passes auth.uid(), so this only ever asks "is the caller an approved
-- admin/manager". set_member_role and approve_member are unaffected for
-- the approved admins who actually use them.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = _role AND is_active = true AND is_pending = false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin','manager') AND is_active = true AND is_pending = false
  );
$$;

-- ============ read policies ============
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated
  USING (
    (id = auth.uid() AND public.is_active_user(auth.uid()))
    OR public.is_approved(auth.uid())
  );

DROP POLICY IF EXISTS "teams_select_all" ON public.teams;
CREATE POLICY "teams_select_all" ON public.teams FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "team_members_select_all" ON public.team_members;
CREATE POLICY "team_members_select_all" ON public.team_members FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "clients_select_all" ON public.clients;
CREATE POLICY "clients_select_all" ON public.clients FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "tags_select_all" ON public.tags;
CREATE POLICY "tags_select_all" ON public.tags FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "projects_select_all" ON public.projects;
CREATE POLICY "projects_select_all" ON public.projects FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "project_members_select_all" ON public.project_members;
CREATE POLICY "project_members_select_all" ON public.project_members FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "project_tags_select_all" ON public.project_tags;
CREATE POLICY "project_tags_select_all" ON public.project_tags FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- Both were USING (true), so readable even by removed members.
DROP POLICY IF EXISTS "project_task_categories_select_all" ON public.project_task_categories;
CREATE POLICY "project_task_categories_select_all" ON public.project_task_categories
  FOR SELECT TO authenticated USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "announcement_teams_select" ON public.announcement_teams;
CREATE POLICY "announcement_teams_select" ON public.announcement_teams FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

-- Unchanged from 20260828100000 apart from is_active_user -> is_approved.
DROP POLICY IF EXISTS "announcements_select" ON public.announcements;
CREATE POLICY "announcements_select" ON public.announcements FOR SELECT TO authenticated
  USING (
    public.is_approved(auth.uid())
    AND (
      audience = 'everyone'
      OR author_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.announcement_teams at
        JOIN public.team_members tm ON tm.team_id = at.team_id
        WHERE at.announcement_id = announcements.id AND tm.user_id = auth.uid()
      )
    )
  );
