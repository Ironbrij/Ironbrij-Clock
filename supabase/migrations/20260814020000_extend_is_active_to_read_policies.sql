-- Final Product Review H24: is_active_user() (20260812060000) was folded into
-- has_role()/can_manage() and wrapped directly around the self-access branches
-- of time_entries/timesheets, but nine other tables' SELECT policies
-- (20260804000910) were left as bare "USING (true)" — a removed member whose
-- access token hadn't yet expired (the same narrow window H15 already had to
-- reason about) could still read the org directory, every team, client,
-- project, and tag. Same fix H15 already proved out, same function, applied
-- to the remaining read policies.
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "teams_select_all" ON public.teams;
CREATE POLICY "teams_select_all" ON public.teams FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "team_members_select_all" ON public.team_members;
CREATE POLICY "team_members_select_all" ON public.team_members FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "clients_select_all" ON public.clients;
CREATE POLICY "clients_select_all" ON public.clients FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "tags_select_all" ON public.tags;
CREATE POLICY "tags_select_all" ON public.tags FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "projects_select_all" ON public.projects;
CREATE POLICY "projects_select_all" ON public.projects FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "project_members_select_all" ON public.project_members;
CREATE POLICY "project_members_select_all" ON public.project_members FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "project_tags_select_all" ON public.project_tags;
CREATE POLICY "project_tags_select_all" ON public.project_tags FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "settings_select_all" ON public.workspace_settings;
CREATE POLICY "settings_select_all" ON public.workspace_settings FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()));
