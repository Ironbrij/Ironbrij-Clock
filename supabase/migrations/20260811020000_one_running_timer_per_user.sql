-- Nothing previously stopped the same person from having more than one
-- "running" time entry (end_time IS NULL) at once — the only guard was
-- client-side React state, which two tabs, two devices, or a second login
-- session each have their own copy of. This partial unique index makes a
-- second concurrent timer for the same user impossible at the database
-- level: the second INSERT fails with a unique_violation (23505), which
-- the app now catches and turns into a friendly "you already have a timer
-- running" message instead of a raw DB error.
--
-- Before applying to a database with existing data, check for violations
-- first (this must return zero rows or the index creation will fail):
--   SELECT user_id, COUNT(*) FROM public.time_entries
--   WHERE end_time IS NULL GROUP BY user_id HAVING COUNT(*) > 1;
-- If it doesn't, stop every extra running entry (or delete the accidental
-- duplicates) before running this migration.
CREATE UNIQUE INDEX time_entries_one_running_per_user
  ON public.time_entries (user_id)
  WHERE (end_time IS NULL);
