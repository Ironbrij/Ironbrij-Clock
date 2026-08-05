-- Reports needs hours-by-project for an arbitrary, user-chosen date range.
-- The existing project_hours() function is fixed to "all time" + "this
-- week" and is also used by the Dashboard — rather than change its
-- behavior (and risk affecting that), this adds a separate, additive
-- function just for Reports. Same company-wide-visibility shape as
-- project_hours() (LEFT JOIN keeps every project, even ones with zero
-- hours in range, and SECURITY DEFINER keeps this consistent with how
-- project_hours() is already exposed to every authenticated user today).
CREATE OR REPLACE FUNCTION public.project_hours_range(_from date, _to date)
RETURNS TABLE (project_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
         ), 0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours_range(date, date) TO authenticated;
