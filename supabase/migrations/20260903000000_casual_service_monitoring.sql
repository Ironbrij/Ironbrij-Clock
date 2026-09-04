-- M46: Casual Service Monitoring — reintroduces the accounts team's manual
-- "Casual Service Monitoring.xlsx" workbook's two per-line fields as real
-- columns on time_entries, following the exact per-entry pattern M26
-- already established for is_billable (a category/status that varies row
-- by row for the same client/project, not a project-level default).
--
-- NULL means "not a casual-monitoring entry at all" (the overwhelming
-- majority of rows, and the default for every entry created before and
-- after this migration) — distinct from the 'ironbrij' category value,
-- which IS a casual-monitoring entry (internal/no-charge casual work),
-- just not a billable one. Conflating the two would corrupt both the
-- client-health query (20260903010000_casual_service_reports.sql) and the
-- rounding-rule scoping (src/lib/casual-billing.ts).
CREATE TYPE public.casual_service_category AS ENUM (
  'ironbrij', 'paid_casual', 'vip_client', 'promotional'
);

ALTER TABLE public.time_entries
  ADD COLUMN service_category public.casual_service_category,
  -- Accounts-team-set status flag: deliberately a date, not a boolean —
  -- keeping "when," not just "whether," matches the source workbook and
  -- what a payout report actually wants. NULL = not yet paid. Only ever
  -- written via the admin-only markCasualEntriesPaid server function
  -- (src/lib/admin.functions.ts), never through the regular updateEntry
  -- path a row's own owner can call — see that function's own comment.
  ADD COLUMN va_paid_at date;

-- A paid-date only makes sense on a row that's actually in the casual
-- program — guards against a stray write on an ordinary retainer entry.
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_va_paid_requires_category
    CHECK (va_paid_at IS NULL OR service_category IS NOT NULL);

CREATE INDEX time_entries_service_category_idx
  ON public.time_entries (service_category) WHERE service_category IS NOT NULL;
