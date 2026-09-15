-- M49: VA placements — the retainer half of the business, from the
-- accounts workbook's "VA Package" sheet. A VA is placed with a client on
-- a monthly arrangement: the VA is paid a monthly rate, the client pays a
-- package price, and the difference is Ironbrij's management fee.
--
-- None of this was visible to IronTrack before. Two structural reasons:
--
--   1. Placed VAs are NOT IronTrack users — they're staffing placements,
--      log no time here, and have no profiles row. Hence placed_vas below
--      rather than a FK to profiles.
--   2. Many of their clients had no clients row either, because clients
--      only ever got rows for people who did casual hourly work. The
--      retainer book was invisible.
--
-- Consequence this fixes: Reports' Gross Profit tab (M48) showed only
-- hourly margin and silently omitted retainer margin, which for several
-- clients is the only margin they have.
--
-- Deliberately NOT modelled: the workbook's 188-row inactive/win-back
-- history. Importing it would have created ~80 client records for
-- long-dead clients, nearly doubling the client list and cluttering every
-- client picker in the app. That sheet stays in Sheets.

-- Normalised rather than a name on each placement: 6 of the 27 VAs hold
-- more than one placement (Aitana Lamamigo and Gladys Grumo have 3 each),
-- and "show me everything this VA is placed on" is the obvious question.
CREATE TABLE public.placed_vas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.va_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placed_va_id uuid NOT NULL REFERENCES public.placed_vas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  started_on date NOT NULL,
  -- NULL = still live. This IS the status — there's no separate enum —
  -- and it doubles as the upper bound for the daily accrual that
  -- src/lib/retainer.ts computes.
  ended_on date,
  -- Both nullable: 4 sheet rows carry "N/A" pricing (the VA is paid but
  -- the client isn't on a package), and those rows show a $0 management
  -- fee. The fee itself is DERIVED (package - rate, or 0), never stored —
  -- keeping all three in sync is a drift bug waiting to happen.
  va_monthly_rate numeric(10,2) CHECK (va_monthly_rate IS NULL OR va_monthly_rate >= 0),
  client_package_amount numeric(10,2)
    CHECK (client_package_amount IS NULL OR client_package_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT va_placements_dates_ordered CHECK (ended_on IS NULL OR ended_on >= started_on)
);

-- A VA can genuinely be re-placed with the same client later, so the start
-- date is part of the key rather than (va, client) alone. This also makes
-- a re-run of the import idempotent.
CREATE UNIQUE INDEX va_placements_unique_idx
  ON public.va_placements (placed_va_id, client_id, started_on);
CREATE INDEX va_placements_client_idx ON public.va_placements (client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.placed_vas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.va_placements TO authenticated;
GRANT ALL ON public.placed_vas TO service_role;
GRANT ALL ON public.va_placements TO service_role;
ALTER TABLE public.placed_vas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_placements ENABLE ROW LEVEL SECURITY;

-- Same shape as billing_rates_manage and member_employment_manage:
-- admin/manager only for read AND write, no self-visibility carve-out.
-- Placement pricing is commercially sensitive for the same reason a pay
-- rate is. Note Supabase's default privileges already grant `anon`
-- blanket access to new public tables, so these policies are the only
-- thing actually guarding the data.
CREATE POLICY "placed_vas_manage" ON public.placed_vas FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));

CREATE POLICY "va_placements_manage" ON public.va_placements FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
