-- M51: the timer rounded every entry to a whole minute, and floored it at
-- one. compute_time_entry_duration() (see
-- 20260814010000_time_entries_server_side_duration.sql) stored only
--
--     GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60))
--
-- so a 20-second task recorded as a full minute, a 3h29m30s shift recorded
-- as 3h30m, and no report could ever recover the difference. Raised by the
-- product owner as "don't round off seconds to 1 minute" — the rounding is
-- visible in the entry list, in the timesheet, and (once it is multiplied
-- by a pay or invoice rate) in money.
--
-- duration_seconds becomes the stored truth. duration_minutes is kept, and
-- kept byte-identical to what the old trigger produced, because several
-- reporting functions SUM() it — see below for why they are nonetheless
-- rewritten here. Nothing that reads duration_minutes has to change in
-- lockstep with this migration; callers move to seconds when they have a
-- reason to.
--
-- No history is lost by adding this late: start_time and end_time are
-- timestamptz and were never rounded, so the backfill below recovers the
-- exact original duration of every entry ever logged. This migration makes
-- the past *more* precise, not just the future.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- Same one-unit floor the minute column has always had, moved down to the
-- second: a timer started and stopped in the same instant still records as
-- a real (if tiny) entry rather than a zero-length one. At second
-- granularity this is a far smaller lie than it was at minute granularity,
-- which is the entire point of the change.
UPDATE public.time_entries
SET duration_seconds = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time))))::integer
WHERE end_time IS NOT NULL
  AND duration_seconds IS NULL;

-- Mirrors time_entries_duration_non_negative on the minute column. Same
-- reasoning as that constraint's own comment: a backstop against a future
-- bulk-load path that disables triggers, not the primary guarantee.
ALTER TABLE public.time_entries
  DROP CONSTRAINT IF EXISTS time_entries_duration_seconds_non_negative;
ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_duration_seconds_non_negative
  CHECK (duration_seconds IS NULL OR duration_seconds >= 0);

-- duration_minutes is deliberately still computed from the raw interval
-- rather than from the new duration_seconds. Rounding twice (epoch to
-- seconds, then seconds to minutes) disagrees with rounding once at the
-- sub-second boundaries — 89.6s rounds to 1 minute directly but to 2 via
-- 90s — and this migration is not the place to shift a value several
-- reporting functions already sum. The minute column keeps producing
-- exactly what it produced yesterday.
CREATE OR REPLACE FUNCTION public.compute_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.end_time IS NULL THEN
    NEW.duration_seconds := NULL;
    NEW.duration_minutes := NULL;
  ELSE
    NEW.duration_seconds := GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)))
    )::integer;
    NEW.duration_minutes := GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60)
    )::integer;
  END IF;
  RETURN NEW;
END;
$$;

-- The range aggregates below keep their exact signatures and their
-- `minutes int` return contracts — no caller changes — but now sum
-- duration_seconds and round once, at the end, instead of summing values
-- that were each already rounded to a minute.
--
-- That per-entry rounding was the real error source in these totals, and
-- it did not cancel out: the old GREATEST(1, ...) floor only ever rounds
-- up, so a VA logging many short tasks accumulated a systematic
-- overstatement. Summing seconds first bounds the whole total's error at
-- the single final rounding, however many entries went into it.
DROP FUNCTION IF EXISTS public.project_hours_range(date, date, uuid);
CREATE FUNCTION public.project_hours_range(_from date, _to date, _team_id uuid DEFAULT NULL)
RETURNS TABLE (project_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0) / 60.0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours_range(date, date, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.project_billable_hours_range(date, date, uuid);
CREATE FUNCTION public.project_billable_hours_range(_from date, _to date, _team_id uuid DEFAULT NULL)
RETURNS TABLE (project_id uuid, billable_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
             AND (_team_id IS NULL OR EXISTS (
               SELECT 1 FROM public.team_members tm
               WHERE tm.user_id = te.user_id AND tm.team_id = _team_id
             ))
         ), 0) / 60.0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_billable_hours_range(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_billable_hours_range(date, date, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.employee_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_hours_range(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.employee_billable_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to AND te.is_billable
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id;
$$;
REVOKE ALL ON FUNCTION public.employee_billable_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_billable_hours_range(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.employee_client_hours_range(_from date, _to date)
RETURNS TABLE (user_id uuid, client_id uuid, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pr.id, p.client_id,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= _from AND te.entry_date <= _to
         ), 0) / 60.0)::int
  FROM public.profiles pr
  LEFT JOIN public.time_entries te ON te.user_id = pr.id
  LEFT JOIN public.projects p ON p.id = te.project_id
  WHERE pr.id = auth.uid()
     OR public.has_role(auth.uid(), 'admin')
     OR (public.has_role(auth.uid(), 'manager') AND public.shares_team(auth.uid(), pr.id))
  GROUP BY pr.id, p.client_id;
$$;
REVOKE ALL ON FUNCTION public.employee_client_hours_range(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_client_hours_range(date, date) TO authenticated;

-- project_hours() feeds projects.hours, which useClientBudgets subtracts
-- from a client's subscription allowance — so its rounding error is what a
-- client's "remaining hours" inherits.
CREATE OR REPLACE FUNCTION public.project_hours()
RETURNS TABLE (project_id uuid, total_minutes int, week_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id,
         ROUND(COALESCE(SUM(te.duration_seconds), 0) / 60.0)::int,
         ROUND(COALESCE(SUM(te.duration_seconds) FILTER (
           WHERE te.entry_date >= date_trunc('week', now())::date
             AND te.entry_date < (date_trunc('week', now()) + interval '7 days')::date
         ), 0) / 60.0)::int
  FROM public.projects p
  LEFT JOIN public.time_entries te ON te.project_id = p.id
  GROUP BY p.id;
$$;
REVOKE ALL ON FUNCTION public.project_hours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_hours() TO authenticated;
