-- M17: no duplicate-name protection existed for teams, tags, or task
-- categories (clients alone had a DB UNIQUE). Since `task` on a time entry
-- is free text, duplicate task-category names actively collide in the
-- "recent tasks" grouping (orderByRecencyName, keyed by name).
--
-- Case-insensitive, unlike clients' plain UNIQUE: these are short,
-- human-retyped labels, and an accidental "Design" vs "design" duplicate
-- is exactly the kind of thing this needs to catch.
CREATE UNIQUE INDEX teams_name_unique_ci ON public.teams (lower(name));
CREATE UNIQUE INDEX tags_name_unique_ci ON public.tags (lower(name));
CREATE UNIQUE INDEX task_categories_name_unique_ci ON public.task_categories (lower(name));
