-- Makes the "task" list on time entries admin-configurable instead of
-- hardcoded in source code — the actual inconsistency flagged in the
-- original review (Tags were DB-backed, Task wasn't). Deliberately kept
-- as its own table rather than merged into tags: entries store `task` as
-- plain text (not a foreign key), so deleting a category here never
-- breaks historical entries — it only changes what's offered going
-- forward as a selectable option.
CREATE TABLE public.task_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_categories TO authenticated;
GRANT ALL ON public.task_categories TO service_role;
ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_categories_select_all" ON public.task_categories FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));
CREATE POLICY "task_categories_write_manage" ON public.task_categories FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));

-- Seed with exactly what was hardcoded before, in the same order, so
-- nothing changes for anyone until an admin actually edits the list.
INSERT INTO public.task_categories (name) VALUES
  ('Development'),
  ('Design'),
  ('Client call'),
  ('Research'),
  ('QA & testing'),
  ('Admin');
