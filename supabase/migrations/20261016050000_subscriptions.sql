-- Software subscriptions (decided 2026-10-16).
--
-- A dedicated Subscriptions page tracks what the company pays for software,
-- in three groups — AI tools, editing tools, other — with the department
-- (team) that uses each one, for expense tracking and cost allocation.
-- Managers and admins only.
--
-- Each subscription keeps its own currency: tools are often billed in USD
-- while the workspace reports in AUD, and the page never adds different
-- currencies together.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text NOT NULL CHECK (category IN ('ai_tools', 'editing_tools', 'other')),
  -- The department using it. Null when it's company-wide or not assigned yet.
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  department_note text,
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'AUD' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'annual', 'other')),
  renews_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_category_idx ON public.subscriptions (category);

-- Supabase grants ALL on new tables by default, so start from nothing.
REVOKE ALL ON public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_manage" ON public.subscriptions;
CREATE POLICY "subscriptions_manage" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
