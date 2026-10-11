-- Product decision 2026-10-11: a placement's VA rate is set per hour, not
-- per month. Placed VAs aren't IronTrack users and log no time here
-- (20260915010000_va_placements.sql), so an hourly rate needs contracted
-- hours alongside it to make a cost:
--
--   monthly VA cost = va_hourly_rate × contracted_weekly_hours × 52 ÷ 12
--
-- which src/lib/retainer.ts then accrues daily exactly as before. The
-- management fee is still derived (package − monthly VA cost), never stored.
--
-- va_hourly_rate is numeric(12,6) rather than (10,2) on purpose: the
-- existing monthly rates are converted below, and keeping six decimals keeps
-- each converted placement's monthly cost within a fraction of a cent of
-- what it was. Two decimals would drift by up to ~$0.87/month per placement.
ALTER TABLE public.va_placements
  ADD COLUMN va_hourly_rate numeric(12,6)
    CHECK (va_hourly_rate IS NULL OR va_hourly_rate >= 0),
  ADD COLUMN contracted_weekly_hours numeric(5,2)
    CHECK (contracted_weekly_hours IS NULL OR (contracted_weekly_hours > 0 AND contracted_weekly_hours <= 168));

-- Nobody has recorded contracted hours yet, so existing placements are
-- assumed full-time (40 h/week) and their hourly rate is back-calculated so
-- the monthly cost, and every past Gross Profit figure, is unchanged. Admins
-- should correct each placement's real hours and rate on Billing → Placements.
-- "N/A" rate rows (null) stay null: still unpriced.
UPDATE public.va_placements
SET contracted_weekly_hours = 40,
    va_hourly_rate = va_monthly_rate * 12 / (52 * 40)
WHERE va_monthly_rate IS NOT NULL;

-- Kept for history and rollback; nothing reads or writes it any more.
COMMENT ON COLUMN public.va_placements.va_monthly_rate IS
  'Superseded 2026-10-11 by va_hourly_rate × contracted_weekly_hours. No longer read or written.';
