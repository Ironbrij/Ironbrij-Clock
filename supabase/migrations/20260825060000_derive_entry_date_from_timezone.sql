-- M36: entry_date and start_time were independently supplied,
-- independently trusted values — every server-side business rule that
-- reasons about "which week is this entry in" (week_is_locked(),
-- submit_timesheet(), flag_approved_week_modified(), every Reports RPC)
-- filters by entry_date directly, but nothing ever verified it actually
-- matched the local calendar day start_time falls on for that entry's
-- owner. The client always computes entry_date via toDateKey() in the
-- browser's own local time, which can drift from profiles.timezone (a
-- mutable setting) — a real gap for a team explicitly distributed across
-- timezones (the app's own `timezones` list has Australia/Sydney and
-- Asia/Manila side by side).
--
-- Fixed the same way C6/H20 fixed duration_minutes drift: a BEFORE
-- trigger recomputes entry_date server-side on every write, from
-- start_time interpreted through the entry owner's *current*
-- profiles.timezone, rather than trusting whatever the client sends —
-- removing the possibility of drift entirely instead of trying to detect
-- it after the fact. Plain SECURITY INVOKER (no elevated privilege
-- needed): profiles_select_all already lets any active authenticated
-- user read any profile's timezone, so the trigger runs fine under the
-- calling statement's own already-checked privileges, same reasoning
-- compute_time_entry_duration's own comment already gives for that
-- trigger.
--
-- Known accepted edge case, not fixed here: H8/M21's multi-day split
-- (stopTimer's stop_timer() RPC, createEntry's "ends after midnight"
-- checkbox) still splits at *browser*-local midnight, not the entry
-- owner's profiles.timezone. If those ever genuinely differ, a split
-- entry's per-segment start/end times can straddle this trigger's
-- profile-timezone day boundary differently than the browser-time split
-- intended — a real but low-frequency interaction between two
-- separately-scoped fixes, not a bug introduced by this migration.
-- Making the split itself timezone-aware is a larger, separate change
-- this finding doesn't ask for.
CREATE OR REPLACE FUNCTION public.compute_time_entry_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _tz text;
BEGIN
  SELECT timezone INTO _tz FROM public.profiles WHERE id = NEW.user_id;
  NEW.entry_date := (NEW.start_time AT TIME ZONE COALESCE(_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS time_entries_compute_entry_date ON public.time_entries;
CREATE TRIGGER time_entries_compute_entry_date
BEFORE INSERT OR UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.compute_time_entry_date();
