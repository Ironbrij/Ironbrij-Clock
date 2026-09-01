-- L32: per-day structured weekly schedule, replacing the single shared
-- start/end time currently applied across every selected day. Some
-- employees genuinely keep different hours on different days (e.g. a
-- shorter Friday), which the old single start/end pair (`weekly_schedule`
-- text, composed/parsed by composeWeeklySchedule/parseWeeklySchedule in
-- time-utils.ts) couldn't express.
--
-- Additive, not a rewrite: the old `weekly_schedule` text column is left in
-- place untouched. The client still parses it (parseWeeklySchedule) to seed
-- this new column's initial per-day value for anyone who hasn't been
-- re-saved under the new shape yet — see ScheduleRow in manage.tsx. Once an
-- admin edits any day for a person, that person's row is written under the
-- new column going forward and the legacy text column is simply left as-is
-- (dead, but harmless — nothing else in the app reads it).
--
-- Shape: NULL (nothing set), or a 7-element jsonb array — Mon(0)…Sun(6),
-- the same order as WEEKDAY_ABBR — where each element is either null (day
-- off) or {"start": "HH:MM", "end": "HH:MM"}.
CREATE OR REPLACE FUNCTION public.is_valid_weekly_schedule_days(v jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NULL OR (
    jsonb_typeof(v) = 'array'
    AND jsonb_array_length(v) = 7
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v) AS elem
      WHERE elem <> 'null'::jsonb
        AND (
          jsonb_typeof(elem) <> 'object'
          OR NOT (elem ? 'start' AND elem ? 'end')
          OR elem->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          OR elem->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.is_valid_weekly_schedule_days(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_weekly_schedule_days(jsonb) TO authenticated;

ALTER TABLE public.member_employment
  ADD COLUMN weekly_schedule_days jsonb
    CONSTRAINT weekly_schedule_days_shape CHECK (public.is_valid_weekly_schedule_days(weekly_schedule_days));
