-- Drops the no-overlap guarantee added in 20260811030000_time_entries_no_overlap.sql.
-- Product decision: mirror Clockify, where two entries for the same person
-- are allowed to overlap in time (e.g. logging a client call that happened
-- while a longer task was also being worked). The client-side overlap check
-- (overlapsExisting, previously enforced in createEntry/updateEntry) has
-- also been removed to match — see use-time-entries.ts.
--
-- The one-running-timer-per-user partial unique index from the migration
-- before this one is untouched: you still can't have two *running* (no
-- end_time) entries at once, only completed entries with overlapping
-- ranges are now allowed.
ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_no_overlap;
