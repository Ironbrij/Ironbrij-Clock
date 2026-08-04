DROP VIEW IF EXISTS public.project_hours;
DROP VIEW IF EXISTS public.tag_usage;

CREATE OR REPLACE FUNCTION public.project_hours()
RETURNS TABLE (project_id uuid, total_minutes int, week_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(SUM(te.duration_minutes), 0)::int,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= date_trunc('week', now())::date
             AND te.entry_date < (date_trunc('week', now()) + interval '7 days')::date
         ), 0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours() TO authenticated;

CREATE OR REPLACE FUNCTION public.tag_usage()
RETURNS TABLE (tag_id uuid, entry_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, COUNT(te.id)::int
  FROM public.tags t
  LEFT JOIN public.time_entries te ON t.id = ANY (te.tag_ids)
  GROUP BY t.id;
$$;
REVOKE ALL ON FUNCTION public.tag_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tag_usage() TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.shares_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_team(uuid, uuid) TO authenticated;