-- M28: Reports had no billable vs. non-billable breakdown on either tab.
-- The employee side can already be derived client-side from
-- employee_hours_range (total) and employee_billable_hours_range (H17,
-- billable-only) — but there's no equivalent "billable hours per project"
-- source, since a project's own is_billable flag is only ever its
-- *default* (M26 lets a single entry override it), so the real answer has
-- to come from summing time_entries.is_billable per row, not from
-- projects.is_billable. Same company-wide visibility and LEFT JOIN shape
-- as project_hours_range (every project appears, even at zero).
CREATE OR REPLACE FUNCTION public.project_billable_hours_range(_from date, _to date)
RETURNS TABLE (project_id uuid, billable_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
         ), 0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_billable_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_billable_hours_range(date, date) TO authenticated;
