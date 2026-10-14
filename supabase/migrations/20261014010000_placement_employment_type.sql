-- Product decision 2026-10-14: Billing → Placements splits external (placed)
-- VAs into full-time and part-time sections. The label is set per placement
-- rather than per VA, since a VA on two clients can be part-time on both, and
-- it's chosen explicitly rather than derived from contracted hours.
--
-- Same values as member_employment.employment_type, which does the same job
-- for IronTrack's own staff. No grant or policy changes: the table-level
-- grant and va_placements_manage (can_manage only) already cover a new
-- column.
ALTER TABLE public.va_placements
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time'));

-- Starting point only: anything contracted under 30 hours a week starts as
-- part-time. Most placements still carry the 40 h/week default from
-- 20261011030000, so they start as full-time, and admins correct each one
-- on the tab.
UPDATE public.va_placements
SET employment_type = 'part_time'
WHERE contracted_weekly_hours < 30;
