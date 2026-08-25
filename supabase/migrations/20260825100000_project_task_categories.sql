-- M25: task_categories was a single flat, workspace-wide list every
-- project shared, with no way to give a project its own distinct task
-- breakdown. Same shape as project_tags — a join table, not a rewrite of
-- task_categories itself, so a project with no rows here is unrestricted
-- (falls back to the full global list, today's exact behavior), and only
-- a project that's deliberately been given a scoped list narrows to it.
CREATE TABLE public.project_task_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_category_id uuid NOT NULL REFERENCES public.task_categories(id) ON DELETE CASCADE,
  UNIQUE (project_id, task_category_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_task_categories TO authenticated;
GRANT ALL ON public.project_task_categories TO service_role;
ALTER TABLE public.project_task_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_task_categories_select_all" ON public.project_task_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_task_categories_write_manage" ON public.project_task_categories
  FOR ALL TO authenticated
  USING (public.can_manage(auth.uid())) WITH CHECK (public.can_manage(auth.uid()));
