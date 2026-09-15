-- M48: Gross Profit reporting — the client *invoice* rate, the one fact
-- needed to turn tracked hours into revenue. Until now the only money in
-- the schema was member_employment.hourly_rate (the cost side) and
-- workspace_settings.currency; the accounts team computed every margin by
-- hand in the "Accounts Weekly Report" workbook's CS Profit / Coaching
-- Profit / Gross Profit sheets.
--
-- A separate table rather than a column on clients, for two reasons:
--
--   1. clients_select_all makes every clients row readable by any
--      authenticated user. An invoice rate sitting next to a VA's own pay
--      rate is exactly the sensitive-payroll case member_employment is
--      already locked down for — a VA should not be able to read that
--      their client is billed $18.68/hr for their $6.00/hr time.
--   2. Rates are effective-dated, which needs one row per change, not one
--      per client.
--
-- user_id NULL is the client's default rate; a non-NULL user_id is a
-- per-VA override for that client, which wins where one exists. This
-- mirrors the source workbook, where the same client carries different
-- rates depending on who did the work (Carol Stimpson bills at $18.68 via
-- Jose but $17.59 via Carlo).
--
-- Note the deliberate asymmetry with member_employment, which is NOT
-- effective-dated: the workbook's own rate side-table lists one stable
-- rate per VA ($8.08 Vellih, $6.00 Jose, ...), while client invoice rates
-- demonstrably move week to week. Historical cost therefore uses today's
-- pay rate; historical revenue uses the rate that actually applied. That
-- was the confirmed call, not an oversight.
CREATE TABLE public.billing_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- NULL = this client's default rate; non-NULL = a per-VA override.
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_rate numeric(10,2) NOT NULL CHECK (hourly_rate >= 0),
  -- The date this rate starts applying. Resolution picks the latest row
  -- with effective_from <= the entry's own date, so a rate entered today
  -- never retroactively rewrites last month's report.
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One rate per scope per date. Two partial indexes rather than a single
-- UNIQUE (client_id, user_id, effective_from), because Postgres treats
-- NULLs as distinct — that constraint would let the same client default
-- be inserted twice for the same date.
CREATE UNIQUE INDEX billing_rates_client_default_idx
  ON public.billing_rates (client_id, effective_from) WHERE user_id IS NULL;
CREATE UNIQUE INDEX billing_rates_client_va_idx
  ON public.billing_rates (client_id, user_id, effective_from) WHERE user_id IS NOT NULL;

-- Lookups are always "every rate for this client," then resolved in JS.
CREATE INDEX billing_rates_client_idx ON public.billing_rates (client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_rates TO authenticated;
GRANT ALL ON public.billing_rates TO service_role;
ALTER TABLE public.billing_rates ENABLE ROW LEVEL SECURITY;

-- Copied verbatim from member_employment_manage: admin/manager only for
-- BOTH read and write, no self-visibility carve-out, for the same reason.
CREATE POLICY "billing_rates_manage" ON public.billing_rates FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
