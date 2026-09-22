-- M51: the client billing uplift — the percentage added to tracked hours
-- before they are rounded up and invoiced.
--
-- Deliberately a separate column from casual_billing_increment_hours rather
-- than a reinterpretation of it. The two are different operations that
-- happen to be applied together:
--
--   * casual_billing_increment_hours (0.25) is a rounding *step* — the
--     granularity the client is billed in.
--   * client_billing_uplift_pct (20) is a *markup* on the hours themselves.
--
-- Order matters and is fixed in code: uplift first, then round up. 6.10h
-- becomes 7.32h becomes 7.50h. Rounding first happens to give the same
-- answer for that example but diverges as soon as the decimals fall
-- differently, so src/lib/casual-billing.ts states the order explicitly
-- rather than leaving it to whichever call site runs first.
--
-- Scope is unchanged from M46 and was re-confirmed when M51 was specified:
-- this only ever applies to the three paid casual categories (paid_casual,
-- vip_client, promotional). Ironbrij-category work, regular client work and
-- retainer work all pass through at their exact tracked hours.
--
-- The uplift is applied client-side at report time (same as the increment
-- it sits next to), never written back onto an entry — raw tracked time
-- stays the source of truth.
--
-- Defaulting to 20 rather than 0 means every casual figure in Reports moves
-- the moment this lands, including for past periods. That is the intent:
-- the product owner asked for the uplift as the standing billing rule, not
-- as something that starts applying from a cutover date. Set it to 0 to
-- restore exactly the pre-M51 numbers.
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS client_billing_uplift_pct numeric(5,2) NOT NULL DEFAULT 20
    CONSTRAINT workspace_settings_client_uplift_check
      CHECK (client_billing_uplift_pct >= 0 AND client_billing_uplift_pct <= 1000);
