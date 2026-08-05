-- Closes the gap from the original security review: every one of these
-- tables was readable by ANY authenticated user, including someone who
-- just signed in and hasn't been approved yet — meaning an unapproved
-- account could read the full staff directory, team structure, client
-- list, and project roster before an admin ever looked at them.
--
-- The fix: a pending account can now only see their own row in profiles
-- (needed so the "Awaiting approval" screen itself can render) and gets
-- nothing at all from teams, team_members, clients, tags, projects,
-- project_members, or project_tags until an admin approves them. Once
-- approved, visibility goes back to exactly what it was before — this
-- only tightens the pending window, nothing else changes for anyone
-- already approved.
--
-- workspace_settings is deliberately left alone (still USING (true)) —
-- it's just company name/logo/timezone/currency, low-sensitivity, and
-- plausibly wanted for branding on the waiting screen itself.

CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT NOT is_pending FROM public.profiles WHERE id = _user_id), false);
$$;
REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated;

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_approved(auth.uid()));

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
