-- M50: a fixed weekly salary per member, so permanent staff cost can stop
-- being computed as hours x hourly_rate.
--
-- The accounts workbook's CS Profit sheet nets casual gross profit against
-- the team's fixed weekly salary bill (Creatives is exactly 811.36 every
-- week, whatever hours anyone logged) to answer "did casual work cover
-- payroll this week". IronTrack could not reproduce that line: gross-profit.ts
-- has only ever known hours x rate, and nothing in the schema distinguished a
-- salaried member from an hourly one.
--
-- Columns here rather than a new table, unlike M48's billing_rates: there is
-- exactly one current salary per member, and member_employment is already the
-- manager/admin-only home for pay data. billing_rates needed its own table
-- because a rate varies per VA *and* per client and demonstrably changes week
-- to week; a salary does neither.
--
-- weekly_salary IS NOT NULL is what makes a member salaried — no new
-- employment_type, no separate flag, and no migration of existing rows. That
-- keeps the rule in one place: a salary is set, or it is not.
--
-- salary_from / salary_to exist because a salary accrues in weeks where the
-- member logged no time at all. Without an end date, a member who leaves would
-- keep drawing payroll in every report forever, silently — the same class of
-- quiet, compounding wrongness the duplicate-import cleanup just dealt with.
-- Dates also mean a leaver's past weeks keep their real cost instead of being
-- rewritten to zero, which is what blanking the amount would do. This mirrors
-- the clipping va_placements already does with started_on / ended_on.
--
-- No RLS work: member_employment_manage is FOR ALL on the table and already
-- covers new columns. That policy is manager/admin-only for both read and
-- write, with no self-visibility carve-out, so a member still cannot read
-- their own salary — deliberate, and the same reason billing_rates is not a
-- column on clients.

ALTER TABLE public.member_employment
  ADD COLUMN IF NOT EXISTS weekly_salary numeric(10,2),
  ADD COLUMN IF NOT EXISTS salary_from date,
  ADD COLUMN IF NOT EXISTS salary_to date;

ALTER TABLE public.member_employment
  DROP CONSTRAINT IF EXISTS member_employment_weekly_salary_check;
ALTER TABLE public.member_employment
  ADD CONSTRAINT member_employment_weekly_salary_check
  CHECK (weekly_salary IS NULL OR weekly_salary >= 0);

ALTER TABLE public.member_employment
  DROP CONSTRAINT IF EXISTS member_employment_salary_range_check;
ALTER TABLE public.member_employment
  ADD CONSTRAINT member_employment_salary_range_check
  CHECK (salary_to IS NULL OR salary_from IS NULL OR salary_to >= salary_from);

-- A salary with no start date cannot be prorated across a report range, so the
-- amount and its start are required together. An open-ended salary_to is fine
-- and means "still employed".
ALTER TABLE public.member_employment
  DROP CONSTRAINT IF EXISTS member_employment_salary_needs_start_check;
ALTER TABLE public.member_employment
  ADD CONSTRAINT member_employment_salary_needs_start_check
  CHECK (weekly_salary IS NULL OR salary_from IS NOT NULL);

COMMENT ON COLUMN public.member_employment.weekly_salary IS
  'Fixed weekly salary. Non-null makes the member salaried: their cost is this flat figure, not hours x hourly_rate.';
COMMENT ON COLUMN public.member_employment.salary_from IS
  'First day the weekly salary applies. Required whenever weekly_salary is set.';
COMMENT ON COLUMN public.member_employment.salary_to IS
  'Last day the weekly salary applies; NULL means still employed.';
