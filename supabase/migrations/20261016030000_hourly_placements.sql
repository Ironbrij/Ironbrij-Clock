-- Hourly placements on weekly hours (decided 2026-10-16).
--
-- The accounts team's "Weekly Financial" sheet bills placed VAs by the hour
-- on each week's actual hours: paid = hours x VA rate, invoiced = hours x the
-- client's invoice rate (e.g. Ainah Ronquillo, Oct 5-11: 43.5 h x $12.31 paid,
-- x $14.86 invoiced). IronTrack priced placements as a monthly package spread
-- over 365 days, which can't follow a week where the hours differ from the
-- contract. So:
--
--   1. Each placement gets the client's invoice rate per hour.
--   2. Accounts enters each week's actual hours per placement in Billing ->
--      Placements; a week with nothing entered falls back to the contracted
--      hours (src/lib/retainer.ts, placementWeekFigures).
--
-- LMT placements use the same columns with hours meaning units.

-- 1. The client's invoice rate. numeric(12,6), the same precision
--    20261011030000 gave va_hourly_rate, so the seeded rate below reproduces
--    each existing package to the cent rather than drifting by rounding.
ALTER TABLE public.va_placements
  ADD COLUMN IF NOT EXISTS client_hourly_rate numeric(12,6)
    CHECK (client_hourly_rate IS NULL OR client_hourly_rate >= 0);

-- Seed it from the monthly package: package / (contracted hours x 52 / 12).
-- Only where the rate is still empty and both inputs exist, so a re-run
-- changes nothing. Accounts then corrects any rate that doesn't match the
-- sheet. client_package_amount is kept, but nothing prices from it any more.
UPDATE public.va_placements
SET client_hourly_rate = round(client_package_amount * 12 / (52 * contracted_weekly_hours), 6)
WHERE client_hourly_rate IS NULL
  AND client_package_amount IS NOT NULL
  AND contracted_weekly_hours > 0;

-- 2. Actual hours per placement per Monday-to-Sunday week. One row per
--    placement and week; no row means "use the contracted hours". Deleting a
--    placement deletes its weeks, the same as its history everywhere else.
CREATE TABLE IF NOT EXISTS public.placement_week_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.va_placements(id) ON DELETE CASCADE,
  -- Monday-start weeks everywhere in this app (startOfWeek in time-utils.ts).
  week_start date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  hours numeric(6,2) NOT NULL CHECK (hours >= 0 AND hours <= 168),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT placement_week_hours_unique UNIQUE (placement_id, week_start)
);
CREATE INDEX IF NOT EXISTS placement_week_hours_week_idx
  ON public.placement_week_hours (week_start);

-- Same access as va_placements: managers and admins only. Supabase grants
-- ALL on new tables to anon/authenticated by default, so start from nothing.
REVOKE ALL ON public.placement_week_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.placement_week_hours TO authenticated;
GRANT ALL ON public.placement_week_hours TO service_role;

ALTER TABLE public.placement_week_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "placement_week_hours_manage" ON public.placement_week_hours;
CREATE POLICY "placement_week_hours_manage" ON public.placement_week_hours
  FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
