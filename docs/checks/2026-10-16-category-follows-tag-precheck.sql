-- Read-only. Run in the Supabase SQL editor BEFORE merging the
-- category-follows-project-tag change, which applies automatically on merge.
-- Four queries; each is a complete statement with its own WITH clause, so you
-- can select any one of them and run it on its own. Nothing here changes data.
--
-- The four tags are matched by the same case-insensitive name the migration uses.

-- 1. Which of the four tags exist. A missing one means its projects get no
--    category until an admin links the right tag by hand.
WITH mapping(tag_name, category) AS (
  VALUES
    ('paid casual service (implement)', 'paid_casual'::public.casual_service_category),
    ('vip client (clarify)', 'vip_client'),
    ('promotional', 'promotional'),
    ('ironbrij', 'ironbrij')
)
SELECT m.tag_name AS expected_tag, t.id, t.name AS actual_name
FROM mapping m
LEFT JOIN public.tags t ON lower(t.name) = m.tag_name
ORDER BY m.tag_name;

-- 2. Projects carrying two or more of these tags. Must be empty: any row here
--    makes the migration fail. Fix the project's tags first.
WITH mapping(tag_name) AS (
  VALUES ('paid casual service (implement)'), ('vip client (clarify)'), ('promotional'), ('ironbrij')
)
SELECT p.name AS project, string_agg(t.name, ', ') AS category_tags
FROM public.project_tags pt
JOIN public.tags t ON t.id = pt.tag_id
JOIN mapping m ON m.tag_name = lower(t.name)
JOIN public.projects p ON p.id = pt.project_id
GROUP BY p.id, p.name
HAVING count(*) > 1;

-- 3. Entries whose category will change, by project. These are the rows whose
--    billed hours may move; worth a heads-up to the accounts team. Mirrors the
--    backfill: every entry takes its project's category (NULL when it has no
--    project or the project has no category tag), except a VA-paid entry is
--    never set to NULL.
WITH mapping(tag_name, category) AS (
  VALUES
    ('paid casual service (implement)', 'paid_casual'::public.casual_service_category),
    ('vip client (clarify)', 'vip_client'),
    ('promotional', 'promotional'),
    ('ironbrij', 'ironbrij')
),
project_category AS (
  SELECT pt.project_id, m.category
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  JOIN mapping m ON m.tag_name = lower(t.name)
)
SELECT
  COALESCE(p.name, '(no project)') AS project,
  te.service_category AS category_now,
  pc.category AS category_after,
  count(*) AS entries,
  round(sum(COALESCE(te.duration_seconds, 0)) / 3600.0, 2) AS tracked_hours,
  min(te.entry_date) AS earliest,
  max(te.entry_date) AS latest
FROM public.time_entries te
LEFT JOIN public.projects p ON p.id = te.project_id
LEFT JOIN project_category pc ON pc.project_id = te.project_id
WHERE te.service_category IS DISTINCT FROM pc.category
  AND NOT (te.va_paid_at IS NOT NULL AND pc.category IS NULL)
GROUP BY 1, 2, 3
ORDER BY entries DESC;

-- 4. Paid entries the migration leaves alone, because their project has no
--    category tag. Each needs a person to decide.
WITH mapping(tag_name) AS (
  VALUES ('paid casual service (implement)'), ('vip client (clarify)'), ('promotional'), ('ironbrij')
),
categorised_projects AS (
  SELECT DISTINCT pt.project_id
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  JOIN mapping m ON m.tag_name = lower(t.name)
)
SELECT te.id, te.entry_date, COALESCE(p.name, '(no project)') AS project,
       te.service_category, te.va_paid_at
FROM public.time_entries te
LEFT JOIN public.projects p ON p.id = te.project_id
WHERE te.va_paid_at IS NOT NULL
  AND te.service_category IS NOT NULL
  AND (te.project_id IS NULL OR te.project_id NOT IN (SELECT project_id FROM categorised_projects))
ORDER BY te.entry_date;
