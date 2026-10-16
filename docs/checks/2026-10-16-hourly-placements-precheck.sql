-- Read-only. Run in the Supabase SQL editor BEFORE merging the hourly
-- placements change (20261016030000_hourly_placements.sql), which applies
-- automatically on merge. Nothing here changes data. Each query runs on its
-- own: select it and run it.

-- 1. The invoice rate each placement will be given, worked out from its
--    monthly package: package / (contracted hours x 52 / 12). Compare
--    "seeded_rate" with the invoice rate in the Weekly Financial sheet; any
--    that differ can be corrected in Billing → Placements after the merge.
SELECT
  v.full_name AS va,
  c.name AS client,
  p.employment_type AS category,
  p.va_hourly_rate::numeric(10,2) AS va_rate,
  p.contracted_weekly_hours AS hours_per_week,
  p.client_package_amount AS package_per_month,
  round(p.client_package_amount * 12 / (52 * p.contracted_weekly_hours), 2) AS seeded_rate,
  p.ended_on
FROM public.va_placements p
JOIN public.placed_vas v ON v.id = p.placed_va_id
JOIN public.clients c ON c.id = p.client_id
WHERE p.client_package_amount IS NOT NULL
  AND p.contracted_weekly_hours > 0
ORDER BY p.ended_on IS NOT NULL, c.name, v.full_name;

-- 2. Placements that will get NO invoice rate, because the package or the
--    contracted hours are missing. Until a rate is entered they show cost
--    but no invoiced amount, the same as an unpriced placement does today.
SELECT
  v.full_name AS va,
  c.name AS client,
  p.employment_type AS category,
  p.client_package_amount AS package_per_month,
  p.contracted_weekly_hours AS hours_per_week,
  p.ended_on
FROM public.va_placements p
JOIN public.placed_vas v ON v.id = p.placed_va_id
JOIN public.clients c ON c.id = p.client_id
WHERE p.client_package_amount IS NULL
   OR p.contracted_weekly_hours IS NULL
   OR p.contracted_weekly_hours <= 0
ORDER BY p.ended_on IS NOT NULL, c.name, v.full_name;
