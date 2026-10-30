-- Subscriptions used by every department (decided 2026-10-30).
--
-- team_id null already meant "company-wide or not assigned yet", which the
-- Subscriptions page shows as "No department". A tool everyone uses is a
-- different answer from "nobody has said", so it gets its own flag, and its
-- own "All departments" line in the monthly spend summary rather than being
-- split across the teams. It can't also name one department.
--
-- No grant or policy changes: subscriptions_manage (can_manage, FOR ALL)
-- already covers the new column.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS all_departments boolean NOT NULL DEFAULT false;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_all_departments_no_team;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_all_departments_no_team
    CHECK (NOT all_departments OR team_id IS NULL);
