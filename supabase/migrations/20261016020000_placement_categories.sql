-- Placement categories (decided 2026-10-16).
--
-- Billing → Placements splits placed (external) VAs by the department the
-- accounts team's "Weekly Financial" sheet reports them under: Full-Time,
-- Part-Time, Casual VA – External, VIP VA and LMT. 20261014010000 added the
-- first two as va_placements.employment_type; this widens the same column to
-- all five rather than adding a second one, since a placement only ever sits
-- in one department. The app calls it the placement's category.
--
-- External casual VAs don't log time in IronTrack, so they only ever exist
-- here. That is also why the Paid Casual increment (casual_billed_hours /
-- billableHoursForCasualEntry, which only see time entries) can never apply
-- to them: only the internal team's own casual time entries are uplifted.
--
-- The CHECK was declared inline, so Postgres named it
-- va_placements_employment_type_check. Dropped and re-added rather than
-- altered, which keeps this safe to re-run. Existing rows are all full_time
-- or part_time and stay as they are. No grant or policy changes:
-- va_placements_manage (can_manage only) already covers the column.
ALTER TABLE public.va_placements
  DROP CONSTRAINT IF EXISTS va_placements_employment_type_check;
ALTER TABLE public.va_placements
  ADD CONSTRAINT va_placements_employment_type_check
    CHECK (employment_type IN ('full_time', 'part_time', 'casual_external', 'vip', 'lmt'));
