-- M51: per-tag filtering across every Reports tab.
--
-- The Detailed and Casual Service tabs already filtered by tag, because
-- they work from raw time_entries rows the client can filter itself. The
-- Project and Employee tabs could not: they read pre-aggregated SUMs from
-- these functions, which have no tag dimension at all, so there was nothing
-- for the client to filter. Hence an optional _tag_id parameter on each.
--
-- Matched against time_entries.tag_ids — the tags copied onto the entry
-- when it was logged — rather than the project's current tags. That was the
-- product owner's explicit call when M51 was specified: a report should
-- reflect how the work was tagged at the time, so retagging a project today
-- doesn't silently rewrite last quarter's figures. The consequence, worth
-- stating because it will occasionally surprise someone: an entry logged
-- before a tag was added to its project does not carry that tag and will
-- not match it here. Reports' own client-side filters now use the same
-- column, so every tab agrees.
--
-- NULL (the default) skips the filter entirely, so every existing caller
-- behaves exactly as before.
--
-- DROP before CREATE rather than CREATE OR REPLACE: adding a parameter
-- makes a new function signature, and leaving the old one in place would
-- create an overload that PostgREST cannot disambiguate when called with
-- the original argument count.
--
-- Each one keeps the duration_seconds summing introduced in
-- 20260922000000 — the tag filter is added to that body, not to the
-- pre-M51 one.

DROP FUNCTION IF EXISTS public.project_hours_range(date, date, uuid);
CREATE FUNCTION public.project_hours_range(
  _from date,
  _to date,
  _team_id uuid DEFAULT NULL,
  _tag_id uuid DEFAULT NULL
)
RETURNS TABLE (project_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
             AND (_tag_id IS NULL OR _tag_id = ANY (te.tag_ids))
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0) / 60.0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours_range(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours_range(date, date, uuid, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.project_billable_hours_range(date, date, uuid);
CREATE FUNCTION public.project_billable_hours_range(
  _from date,
  _to date,
  _team_id uuid DEFAULT NULL,
  _tag_id uuid DEFAULT NULL
)
RETURNS TABLE (project_id uuid, billable_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
             AND (_tag_id IS NULL OR _tag_id = ANY (te.tag_ids))
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0) / 60.0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_billable_hours_range(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_billable_hours_range(date, date, uuid, uuid) TO authenticated;

-- The three employee functions keep their self/admin/manager-shares-team
-- visibility exactly as written. A tag filter narrows which of the caller's
-- already-visible rows are counted; it must never widen them, which is why
-- it goes in the aggregate's FILTER clause and not the WHERE.
DROP FUNCTION IF EXISTS public.employee_hours_range(date, date);
CREATE FUNCTION public.employee_hours_range(_from date, _to date, _tag_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
             AND (_tag_id IS NULL OR _tag_id = ANY (te.tag_ids))
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_hours_range(date, date, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.employee_billable_hours_range(date, date);
CREATE FUNCTION public.employee_billable_hours_range(
  _from date,
  _to date,
  _tag_id uuid DEFAULT NULL
)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
             AND (_tag_id IS NULL OR _tag_id = ANY (te.tag_ids))
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_billable_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_billable_hours_range(date, date, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.employee_client_hours_range(date, date);
CREATE FUNCTION public.employee_client_hours_range(_from date, _to date, _tag_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, client_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id, p.client_id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
             AND (_tag_id IS NULL OR _tag_id = ANY (te.tag_ids))
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  LEFT JOIN public.projects p ON p.id = te.project_id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id, p.client_id;
$$;
REVOKE ALL ON FUNCTION public.employee_client_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_client_hours_range(date, date, uuid) TO authenticated;

-- Supports the new = ANY (tag_ids) predicate. time_entries is the largest
-- table here and these five functions scan it on every Reports load, so a
-- tag filter without this would mean a full scan per tab switch.
CREATE INDEX IF NOT EXISTS time_entries_tag_ids_idx
  ON public.time_entries USING GIN (tag_ids);
