-- Closes the audit's H9 finding: two tabs (or two devices) on the same
-- account never learned about each other's changes until something
-- happened to trigger a refetch (a window refocus, at best). Multiple
-- concurrent timers are already impossible at the DB level (see the
-- one_running_per_user index), so this is purely about staleness now, not
-- correctness — but a tab showing "no timer running" for a minute after
-- another tab actually started one is still a real, confusing gap.
--
-- Guarded with existence checks since ALTER PUBLICATION ... ADD TABLE has
-- no IF NOT EXISTS form and errors if the table's already a member —
-- makes this safe to run even if one of these was added some other way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'time_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.time_entries;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'timesheets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.timesheets;
  END IF;
END $$;
