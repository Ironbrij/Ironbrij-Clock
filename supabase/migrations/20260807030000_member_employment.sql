-- Employment profile per member: hourly rate, a free-text weekly schedule
-- reference (not a shift-assignment system — deliberately kept simple),
-- and full-time/part-time classification. One row per person, created on
-- first edit rather than pre-populated for everyone.
--
-- Access is admin/manager only for BOTH read and write, with no
-- self-visibility carve-out — rates are sensitive payroll data, and the
-- scope was confirmed as specifically "admins and managers," not "and
-- themselves." A single FOR ALL policy below covers this uniformly.
CREATE TABLE public.member_employment (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time')),
  hourly_rate numeric(10,2),
  weekly_schedule text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_employment TO authenticated;
GRANT ALL ON public.member_employment TO service_role;
ALTER TABLE public.member_employment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_employment_manage" ON public.member_employment FOR ALL TO authenticated
  USING (public.can_manage(auth.uid()))
  WITH CHECK (public.can_manage(auth.uid()));
