-- 2026-10-23: whether a member is on Ironbrij's internal team or a VA placed
-- with a client, for the Type column in Reports → Casual Service's per-VA
-- performance table (the accounts workbook's WEEKLY DASHBOARD).
--
-- Set per person rather than read off a team: the workbook's "Client VAs"
-- team is the placements today, but a team name is a label anyone can edit,
-- and a column that quietly changes meaning when a team is renamed is worse
-- than one an admin sets once. Nor can it come from Billing → Placements:
-- placed_vas rows are names only, with no link to a login.
--
-- 'internal' is the default, so nobody's existing row needs touching; an
-- admin or manager switches the few placements over in Manage → Schedule.
--
-- No RLS work, as with M50's salary columns: member_employment_manage is
-- FOR ALL on the table and already covers new columns, manager/admin-only for
-- both read and write.

ALTER TABLE public.member_employment
  ADD COLUMN IF NOT EXISTS staff_type text NOT NULL DEFAULT 'internal';

ALTER TABLE public.member_employment
  DROP CONSTRAINT IF EXISTS member_employment_staff_type_check;
ALTER TABLE public.member_employment
  ADD CONSTRAINT member_employment_staff_type_check
  CHECK (staff_type IN ('internal', 'placement'));
