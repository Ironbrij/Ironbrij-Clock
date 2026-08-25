-- H17: Reports' Employee view needs billable-hours specifically (not total
-- hours) to compute a $ figure — billable hours * hourly_rate, not total
-- hours * hourly_rate, since a billable project still has genuinely
-- non-billable moments (internal syncs, rework) that shouldn't be billed
-- out. Same shape and same self/admin/manager-shares-team visibility as
-- employee_hours_range, just filtered to is_billable = true.
CREATE OR REPLACE FUNCTION public.employee_billable_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
         ), 0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_billable_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_billable_hours_range(date, date) TO authenticated;
