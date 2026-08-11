-- Neither the app nor the database ever checked a new/edited entry's time
-- range against that same person's other entries — two manual entries for
-- 9:00-11:00 and 10:00-12:00 the same day were both accepted and both
-- counted toward the day/week/project/report totals. This adds a real
-- database-level guarantee for *completed* entries (both start_time and
-- end_time set): no two entries for the same user_id may have overlapping
-- [start_time, end_time) ranges. Uses the half-open range convention, so
-- back-to-back entries (10:00-11:00 then 11:00-12:00) are correctly *not*
-- treated as overlapping.
--
-- Scoped to end_time IS NOT NULL on purpose — a still-running entry has no
-- upper bound yet, and the one-running-timer-per-user index from the
-- previous migration already covers that case. The app additionally does
-- a client-side overlap check (including against a running entry) before
-- ever hitting the database, so this constraint is the backstop, not the
-- only line of defense.
--
-- Before applying to a database with existing data, check for violations
-- first (this must return zero rows or the constraint creation will fail):
--   SELECT a.id, b.id FROM public.time_entries a
--   JOIN public.time_entries b ON a.user_id = b.user_id AND a.id < b.id
--   WHERE a.end_time IS NOT NULL AND b.end_time IS NOT NULL
--     AND tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time);
-- If it doesn't, fix or remove the offending entries before running this
-- migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (end_time IS NOT NULL);
