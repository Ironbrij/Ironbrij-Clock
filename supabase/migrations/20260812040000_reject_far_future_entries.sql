-- L20: the date input's max (today) is a UI hint only — nothing server-side
-- rejected a future-dated entry from a direct API call.
--
-- Bounded on start_time (an unambiguous instant), not entry_date (a plain
-- date with no timezone attached) — checking entry_date against
-- CURRENT_DATE would compare the workspace's local "today" against
-- whatever timezone this database session happens to be in, and could
-- reject a legitimate entry for someone whose local day is already ahead
-- of the server's. A day of slack past now() absorbs any such skew while
-- still catching genuinely future-dated entries.
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_not_far_future CHECK (start_time <= now() + interval '1 day');
