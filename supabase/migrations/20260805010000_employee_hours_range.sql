-- Hours by employee for an arbitrary date range, for the Reports page's
-- Employee view. Deliberately NOT company-wide like project_hours_range —
-- an individual's hours are more sensitive than a project total, so this
-- mirrors the same self/admin/manager-shares-team visibility that
-- time_entries itself already uses, replicated explicitly here since
-- SECURITY DEFINER bypasses RLS (so the access rule has to be written
-- into the query, not left to the table's policies).
CREATE OR REPLACE FUNCTION public.employee_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
         ), 0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_hours_range(date, date) TO authenticated;
