-- Reports' "Team" filter used to mean "which team owns this project"
-- (projects.team_id) — with a special rule that a project with no team
-- ("All teams") matched every filter, meant for genuinely cross-team
-- work. The product owner has since tagged every project "All teams"
-- specifically because multiple teams' members contribute to the same
-- client work, which made that "always match" rule fire for every
-- project, leaving the filter unable to narrow anything at all.
--
-- Confirmed with the product owner: "Team" should mean "hours logged by
-- that team's members," not "which team the project is tagged to" — a
-- single project can now show different, partial hours depending on
-- which team is selected, since multiple teams can log time against the
-- same project. This can't be computed client-side (the existing
-- project_hours_range/project_billable_hours_range aggregate across every
-- user with no per-team dimension), so both gain an optional _team_id
-- parameter, joined against team_members. NULL (the default) behaves
-- exactly as before — company-wide, no team scoping — so this is backward
-- compatible with any caller that omits it.
--
-- A person on multiple teams (team_members is a plain many-to-many join)
-- contributes their full entry minutes under each team they belong to
-- when that team is selected — same "membership, not exclusive
-- attribution" semantics the client already uses for the By-employee
-- tab's team filter (m.teamIds.includes(teamFilter)). No double-counting
-- concern: only one team is ever queried at a time, never summed across
-- teams. shares_team() isn't reusable here — it checks "do two people
-- share any team," not "is this person in this specific team."
DROP FUNCTION IF EXISTS public.project_hours_range(date, date);
CREATE FUNCTION public.project_hours_range(_from date, _to date, _team_id uuid DEFAULT NULL)
RETURNS TABLE (project_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours_range(date, date, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.project_billable_hours_range(date, date);
CREATE FUNCTION public.project_billable_hours_range(_from date, _to date, _team_id uuid DEFAULT NULL)
RETURNS TABLE (project_id uuid, billable_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         COALESCE(SUM(te.duration_minutes) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_billable_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_billable_hours_range(date, date, uuid) TO authenticated;
