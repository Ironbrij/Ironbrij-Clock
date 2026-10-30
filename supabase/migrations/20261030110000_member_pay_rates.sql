-- Team pay with start dates (decided 2026-10-30).
--
-- member_employment held one hourly rate (or one weekly salary) per person,
-- and every cost figure read that one number, so a raise rewrote every past
-- week in every report. Client invoice rates already avoid this with
-- effective dates (billing_rates, 20260915000000); team pay now works the
-- same way.
--
-- Each row applies from effective_from until the person's next row. A row
-- is an hourly rate, a weekly salary, or neither: "no pay from this date",
-- which is how a leaver's salary stops. The pay in effect on a date is the
-- row with the latest effective_from on or before it (src/lib/pay-rates.ts).
--
-- Same access as member_employment: managers and admins, read and write, no
-- self-visibility. Pay is payroll data.
CREATE TABLE IF NOT EXISTS public.member_pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  hourly_rate numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  weekly_salary numeric(10,2) CHECK (weekly_salary IS NULL OR weekly_salary >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT member_pay_rates_one_kind CHECK (hourly_rate IS NULL OR weekly_salary IS NULL),
  CONSTRAINT member_pay_rates_one_per_day UNIQUE (user_id, effective_from)
);

-- Supabase grants ALL on new tables by default, so start from nothing.
REVOKE ALL ON public.member_pay_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_pay_rates TO authenticated;
GRANT ALL ON public.member_pay_rates TO service_role;

ALTER TABLE public.member_pay_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "member_pay_rates_manage" ON public.member_pay_rates;
CREATE POLICY "member_pay_rates_manage" ON public.member_pay_rates
  FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));

-- Seed from member_employment so every past figure comes out exactly as it
-- did (payHistoryFromEmployment in src/lib/pay-rates.ts applies the same
-- rules when this table can't be read):
--   - hourly: the rate from 2000-01-01, which the app shows as "From the start";
--   - salaried: the salary from salary_from, and no hourly row, because a
--     salaried person's time has never cost anything per hour;
--   - salary_to set: "no pay" from the day after.
-- One statement, and only for people with no rows yet, so a re-run can't
-- bring back a row someone has since removed.
INSERT INTO public.member_pay_rates (user_id, effective_from, hourly_rate, weekly_salary)
SELECT s.user_id, s.effective_from, s.hourly_rate, s.weekly_salary
FROM (
  SELECT me.user_id, DATE '2000-01-01' AS effective_from, me.hourly_rate,
         NULL::numeric AS weekly_salary
  FROM public.member_employment me
  WHERE me.hourly_rate IS NOT NULL
    AND (me.weekly_salary IS NULL OR me.salary_from IS NULL)
  UNION ALL
  SELECT me.user_id, me.salary_from, NULL, me.weekly_salary
  FROM public.member_employment me
  WHERE me.weekly_salary IS NOT NULL AND me.salary_from IS NOT NULL
  UNION ALL
  SELECT me.user_id, me.salary_to + 1, NULL, NULL
  FROM public.member_employment me
  WHERE me.weekly_salary IS NOT NULL AND me.salary_from IS NOT NULL
    AND me.salary_to IS NOT NULL
) s
WHERE NOT EXISTS (SELECT 1 FROM public.member_pay_rates r WHERE r.user_id = s.user_id)
ON CONFLICT (user_id, effective_from) DO NOTHING;

COMMENT ON COLUMN public.member_employment.hourly_rate IS
  'Superseded 2026-10-30 by member_pay_rates. No longer read or written.';
COMMENT ON COLUMN public.member_employment.weekly_salary IS
  'Superseded 2026-10-30 by member_pay_rates. No longer read or written.';
COMMENT ON COLUMN public.member_employment.salary_from IS
  'Superseded 2026-10-30 by member_pay_rates. No longer read or written.';
COMMENT ON COLUMN public.member_employment.salary_to IS
  'Superseded 2026-10-30 by member_pay_rates (a no-pay row). No longer read or written.';

-- Live updates across tabs, like member_employment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'member_pay_rates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.member_pay_rates;
  END IF;
END $$;
