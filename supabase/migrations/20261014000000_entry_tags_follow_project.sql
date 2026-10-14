-- Entry tags follow their project (decided 2026-10-14).
--
-- time_entries.tag_ids was copied from the project only when an entry was
-- created (startTimer/createEntry). Moving an entry to another project —
-- e.g. a manager correcting it on Manage > Entries — kept the old project's
-- tags, so Reports kept showing and filtering on them. And because M51 made
-- Reports read tag_ids as "tags at the time", retagging a project never
-- reached entries already logged either. Tags are mostly client names here
-- and staff can't set them per entry, so that snapshot was invisible and
-- uneditable: corrections just looked broken. This reverses M51's rule that
-- report tags reflect how work was tagged when it was logged.
--
-- 1. Bulk tag rewrites (retag_project_entries below, the one-off resync at
--    the end, and the existing delete_tag) must not fire the side effects
--    every time_entries UPDATE otherwise has: re-deriving entry_date from the
--    owner's *current* timezone (which can move a historical entry to another
--    day), an activity_log row per entry edited by someone other than its
--    owner, and stamping entries_modified_at on approved timesheets. Each of
--    those trigger functions now returns early when tag_ids is the only
--    column that changed. That's a check on the row itself, not a session
--    flag, so a real edit can't use it to skip the audit trail.

CREATE OR REPLACE FUNCTION public.compute_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'tag_ids') = (to_jsonb(OLD) - 'tag_ids') THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.compute_time_entry_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _tz text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'tag_ids') = (to_jsonb(OLD) - 'tag_ids') THEN
    RETURN NEW;
  END IF;

  SELECT timezone INTO _tz FROM public.profiles WHERE id = NEW.user_id;
  NEW.entry_date := (NEW.start_time AT TIME ZONE COALESCE(_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_time_entry_edit_by_other()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'tag_ids') = (to_jsonb(OLD) - 'tag_ids') THEN
      RETURN NEW;
    END IF;
    IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_edited',
        NEW.user_id,
        jsonb_build_object('entry_id', NEW.id, 'entry_date', NEW.entry_date)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_deleted',
        OLD.user_id,
        jsonb_build_object(
          'entry_id', OLD.id,
          'entry_date', OLD.entry_date,
          'description', OLD.description
        )
      );
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.flag_approved_week_modified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'tag_ids') = (to_jsonb(OLD) - 'tag_ids') THEN
    RETURN NEW;
  END IF;

  -- Covers both directions of a date-changing UPDATE (moving an entry out
  -- of, or into, an approved week) as well as plain INSERT/DELETE.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = OLD.user_id
      AND status = 'approved'
      AND OLD.entry_date >= week_start
      AND OLD.entry_date < week_start + 7;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'approved'
      AND NEW.entry_date >= week_start
      AND NEW.entry_date < week_start + 7;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. An entry's tags are always its project's tags, set on insert and
--    whenever project_id actually changes — whichever path made the change
--    (Time page, Manage > Entries, a future import). An edit that resends
--    the same project_id (the entry dialog always does) leaves tags alone.
--    SECURITY DEFINER so the lookup doesn't depend on the caller being able
--    to read project_tags.
CREATE OR REPLACE FUNCTION public.sync_entry_tags_from_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id THEN
    RETURN NEW;
  END IF;

  NEW.tag_ids := ARRAY(
    SELECT tag_id FROM public.project_tags
    WHERE project_id = NEW.project_id
    ORDER BY tag_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS time_entries_sync_tags_from_project ON public.time_entries;
CREATE TRIGGER time_entries_sync_tags_from_project
BEFORE INSERT OR UPDATE OF project_id ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_entry_tags_from_project();

-- 3. Changing a project's tags offers "Also apply to entries already logged
--    on this project" (ticked by default). Same can_manage() check as
--    project_tags_write_manage, since the caller has just edited those
--    links; SECURITY DEFINER for the same reason as delete_tag — it has to
--    reach every user's entries, including locked and approved weeks. Tags
--    aren't part of what a timesheet approval signs off, and the guards
--    above keep the rewrite free of side effects. Only rows whose tags
--    differ as a set are touched, so the returned count is "entries that
--    actually changed".
CREATE OR REPLACE FUNCTION public.retag_project_entries(_project_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tags uuid[];
  _count integer;
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to retag entries.';
  END IF;

  _tags := ARRAY(
    SELECT tag_id FROM public.project_tags
    WHERE project_id = _project_id
    ORDER BY tag_id
  );

  UPDATE public.time_entries
  SET tag_ids = _tags
  WHERE project_id = _project_id
    AND NOT (tag_ids @> _tags AND tag_ids <@ _tags);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.retag_project_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retag_project_entries(uuid) TO authenticated;

-- 4. One-off resync: bring every existing entry in line with its project's
--    current tags (an entry with no project carries none). Clears up entries
--    moved between projects before this fix, and older entries on projects
--    retagged since. Runs after the guards above, so it writes no activity
--    log, moves no entry_date and flags no approved week; and it only
--    touches rows that actually differ, keeping the Realtime fan-out small.
WITH current_tags AS (
  SELECT te.id,
         ARRAY(
           SELECT pt.tag_id FROM public.project_tags pt
           WHERE pt.project_id = te.project_id
           ORDER BY pt.tag_id
         ) AS tags
  FROM public.time_entries te
)
UPDATE public.time_entries te
SET tag_ids = ct.tags
FROM current_tags ct
WHERE te.id = ct.id
  AND NOT (te.tag_ids @> ct.tags AND te.tag_ids <@ ct.tags);
