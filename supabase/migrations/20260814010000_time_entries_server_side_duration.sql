-- Database & Data Integrity Audit, C6 (docs/audit-findings.md):
-- time_entries.duration_minutes had no server-side relationship to
-- start_time/end_time at all — every write path (startTimer/stopTimer/
-- createEntry/updateEntry in use-time-entries.ts) computed it in
-- JavaScript and sent it as an independent field, with nothing in the
-- database ever verifying or recomputing it. Every other business-critical
-- value in this schema has a client check *and* a database backstop (week
-- locking, overlap, description-required, manual-entry-allowed,
-- hourly-rate non-negative, future-date bounds) — this was the one
-- exception, and it's the single value Reports, overtime calculations, and
-- the client subscription-hours budget tracking all sum directly.
--
-- Fixed via a BEFORE trigger that recomputes duration_minutes from
-- start_time/end_time server-side on every write, rather than trusting
-- whatever the client sends — the safer of the two options discussed in
-- the audit (vs. a hard CHECK requiring an exact match, which risks
-- rejecting legitimate historical rows if the client's rounding has ever
-- produced an off-by-one-minute value). A trigger never rejects a write;
-- it just makes the stored value always correct going forward, which
-- removes the whole class of drift rather than merely bounding it. Mirrors
-- the app's own Math.max(1, minutes) floor (stopTimer/createEntry in
-- use-time-entries.ts) so a sub-minute entry still records as 1 minute,
-- not 0 — consistent with existing behavior, not a change to it. A
-- still-running entry (end_time IS NULL) has no duration yet, so
-- duration_minutes is forced to NULL for those regardless of what's sent.
--
-- Plain SECURITY INVOKER (the default — omitted below), unlike this
-- schema's other triggers (log_team_membership_change,
-- flag_approved_week_modified, log_time_entry_edit_by_other): those need
-- SECURITY DEFINER because they write to activity_log/timesheets, tables
-- `authenticated` has no direct grant on. This one only ever sets a field
-- on the row already being written by the calling statement, which the
-- statement's own (already-checked) time_entries RLS policy already
-- permits — no elevated privilege is needed or wanted here.
CREATE OR REPLACE FUNCTION public.compute_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.end_time IS NULL THEN
    NEW.duration_minutes := NULL;
  ELSE
    NEW.duration_minutes := GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60)
    )::integer;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS time_entries_compute_duration ON public.time_entries;
CREATE TRIGGER time_entries_compute_duration
BEFORE INSERT OR UPDATE ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.compute_time_entry_duration();

-- Defense-in-depth backstop, not the primary fix (the trigger above is):
-- guarantees duration_minutes can never be negative even if this trigger
-- were ever bypassed (e.g. a future bulk-load path that disables
-- triggers). Safe to add with no pre-existing-data check needed — every
-- current write path already only ever produces NULL or a positive
-- integer here, so no existing row can violate this.
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_duration_non_negative
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0);
