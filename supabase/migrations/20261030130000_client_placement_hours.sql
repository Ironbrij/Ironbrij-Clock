-- Placement hours count down a client's remaining hours (decided 2026-10-30).
--
-- A client's remaining hours are subscription_hours minus every hour tracked
-- on their projects (useClientBudgets, fed by project_hours()). Placed VAs in
-- the Casual VA – External category work a client's casual hours too, but
-- they don't log time in IronTrack, so their hours never came off. Their
-- hours are fixed per week, so accounts doesn't need to enter anything: this
-- works each finished week out the same way billing does.
--
-- For every casual_external placement, each Monday-to-Sunday week from the
-- week it started to the week it ended (or the latest week) that has fully
-- ended counts:
--   - the hours accounts entered for that week in placement_week_hours, else
--   - contracted_weekly_hours x the week's live days / 7, else
--   - 0.
-- That is placementWeekFigures in src/lib/retainer.ts, so the remaining hours
-- and the invoice always agree on a week. An entered 0 is a real 0 (a VA on
-- leave), not "use the contract".
--
-- "Fully ended" is judged in the workspace timezone, so every client's
-- balance drops once a week, on Monday, for everyone at the same time.
--
-- Weeks before accounts imports the sheet's remaining hours count too: the
-- import (Projects -> Clients -> Import remaining hours) sets
-- subscription_hours from a rendered figure that already includes them.
--
-- va_placements and placement_week_hours are managers-only because they hold
-- pay and invoice rates. This returns an hours total per client and nothing
-- else, so it's open to every approved user: staff see the right "hours left"
-- on their timer without seeing what a placed VA is paid. A pending account
-- gets nothing, the same as the clients table.
CREATE OR REPLACE FUNCTION public.client_placement_hours()
RETURNS TABLE (client_id uuid, hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (
    SELECT (now() AT TIME ZONE COALESCE(
      (SELECT ws.timezone FROM public.workspace_settings ws LIMIT 1),
      'Australia/Sydney'
    ))::date AS d
  ),
  -- The Monday of the last week that has fully ended. Plain date arithmetic
  -- rather than date_trunc, which would go through the session timezone.
  bounds AS (
    SELECT d - (EXTRACT(ISODOW FROM d)::int - 1) - 7 AS last_week FROM today
  ),
  weeks AS (
    SELECT p.id AS placement_id, p.client_id, p.started_on, p.ended_on,
           p.contracted_weekly_hours, gs::date AS week_start
    FROM public.va_placements p
    CROSS JOIN bounds b
    CROSS JOIN LATERAL generate_series(
      (p.started_on - (EXTRACT(ISODOW FROM p.started_on)::int - 1))::timestamp,
      LEAST(
        b.last_week,
        COALESCE(p.ended_on - (EXTRACT(ISODOW FROM p.ended_on)::int - 1), b.last_week)
      )::timestamp,
      interval '7 days'
    ) AS gs
    WHERE p.employment_type = 'casual_external'
  ),
  figured AS (
    SELECT w.client_id,
           LEAST(COALESCE(w.ended_on, w.week_start + 6), w.week_start + 6)
             - GREATEST(w.started_on, w.week_start) + 1 AS days,
           pwh.hours AS entered,
           w.contracted_weekly_hours
    FROM weeks w
    LEFT JOIN public.placement_week_hours pwh
      ON pwh.placement_id = w.placement_id AND pwh.week_start = w.week_start
  )
  SELECT f.client_id,
         ROUND(SUM(COALESCE(f.entered, f.contracted_weekly_hours * f.days / 7.0, 0)), 2)
  FROM figured f
  WHERE f.days > 0
    AND public.is_approved(auth.uid())
  GROUP BY f.client_id;
$$;

REVOKE ALL ON FUNCTION public.client_placement_hours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_placement_hours() TO authenticated;
