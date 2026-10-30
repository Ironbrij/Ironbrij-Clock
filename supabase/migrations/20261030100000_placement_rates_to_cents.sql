-- Placement rates to the cent (decided 2026-10-30).
--
-- va_hourly_rate (20261011030000) and client_hourly_rate (20261016030000)
-- were numeric(12,6) so that rates converted from the old monthly packages
-- reproduced each package to the cent. Accounts' own sheet works in cent
-- rates, though: 40 h x $13.63 = $545.20. With six decimals hidden behind a
-- two-decimal display, Reports -> Weekly P&L showed lines no calculator could
-- check (40 h x $7.93 came out as $317.31). Rounding once and narrowing the
-- columns keeps every rate a cent rate from here on; numeric(12,2) rounds
-- anything finer that's typed in.
ALTER TABLE public.va_placements
  ALTER COLUMN va_hourly_rate TYPE numeric(12,2) USING round(va_hourly_rate, 2);
ALTER TABLE public.va_placements
  ALTER COLUMN client_hourly_rate TYPE numeric(12,2) USING round(client_hourly_rate, 2);
