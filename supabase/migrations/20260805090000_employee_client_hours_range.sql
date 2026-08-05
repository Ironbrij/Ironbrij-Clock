-- Powers the Reports "by client" filter on the employee view. The
-- existing employee_hours_range() only ever returns each person's total
-- across every project — it has no idea which client that time went to.
-- This returns one row per (person, client) instead, so the frontend can
-- show "hours this person logged for this specific client" rather than
-- just their grand total. Same access scoping as employee_hours_range()
-- (self / admin / manager-shares-team) since individual hours are
-- sensitive regardless of how they're grouped.
CREATE OR REPLACE FUNCTION public.employee_client_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, client_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id, p.client_id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
         ), 0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  LEFT JOIN public.projects p ON p.id = te.project_id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id, p.client_id;
$$;
REVOKE ALL ON FUNCTION public.employee_client_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_client_hours_range(date, date) TO authenticated;
