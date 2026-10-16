-- Revenue that doesn't come from hours (decided 2026-10-16).
--
-- The accounts team's "Weekly Financial" sheet adds one-off fees on top of
-- the hourly profit: Gross Profit = department profit + Business Coaching +
-- Recruitment and Set Up Fee. IronTrack only knew about hourly revenue, so
-- those fees were missing from Reports -> Gross Profit. They're entered by
-- hand in Billing -> Fees & revenue (invoicing itself stays in Xero).
--
-- Only "recruitment_setup" for now, on the user's instruction ("lets just do
-- recruitment and setup fee first"). Adding another kind later, such as
-- Other revenue or Business Coaching, is a wider CHECK plus a label in
-- src/lib/workspace/types.ts.
CREATE TABLE IF NOT EXISTS public.revenue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The day the fee counts towards: the week and period it is reported in.
  received_on date NOT NULL,
  -- Optional: a fee can belong to no client. Kept if the client is deleted
  -- so past totals don't change.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'recruitment_setup'
    CHECK (kind IN ('recruitment_setup')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revenue_items_received_on_idx
  ON public.revenue_items (received_on);

-- Managers and admins only, the same as billing_rates and va_placements.
-- Supabase grants ALL on new tables by default, so start from nothing.
REVOKE ALL ON public.revenue_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_items TO authenticated;
GRANT ALL ON public.revenue_items TO service_role;

ALTER TABLE public.revenue_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "revenue_items_manage" ON public.revenue_items;
CREATE POLICY "revenue_items_manage" ON public.revenue_items
  FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
