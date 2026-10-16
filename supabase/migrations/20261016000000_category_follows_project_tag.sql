-- A time entry's casual service category follows its project's tag
-- (decided 2026-10-16). Spec:
-- docs/superpowers/specs/2026-10-16-category-follows-project-tag-design.md
--
-- time_entries.service_category used to be a per-entry dropdown, labelled
-- optional, that decides whether Paid Casual's increment applies. Timer
-- entries never got one and the form pre-filled it from the last entry for
-- the same client, so the 1-16 October export had 12 Paid Casual entries
-- billed without the increment and 30 internal/VIP entries billed with it.
--
-- A project is only ever one kind of work, so the project's tag is now the
-- only label: a tag can be linked to a category (admins only), a project can
-- carry at most one such tag, and every entry's category is derived from it.
-- The entry column stays, so reports, casual_report_for_client() and
-- time_entries_va_paid_requires_category keep reading it unchanged.

-- 1. Which billing category a tag stands for. NULL for ordinary tags.
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS service_category public.casual_service_category;

-- 2. A project's category: its category tag's, or NULL. At most one such tag
--    exists per project (section 5); ORDER BY just makes it deterministic.
CREATE OR REPLACE FUNCTION public.project_service_category(_project_id uuid)
RETURNS public.casual_service_category
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.service_category
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  WHERE pt.project_id = _project_id
    AND t.service_category IS NOT NULL
  ORDER BY t.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.project_service_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_service_category(uuid) TO authenticated;

-- 3. Bring entries in line with their project's category. NULL means every
--    entry; an empty array means none. Callers building the list from a
--    query must use ARRAY(...) (empty when nothing matches), never
--    array_agg (NULL when nothing matches, which would mean everything).
--
--    An entry already marked VA-paid is never left without a category:
--    time_entries_va_paid_requires_category forbids it, and a paid record
--    shouldn't be silently rewritten. It keeps its category instead.
--
--    Returns the ids it changed, so retag_project_entries can count an
--    entry whose tags and category both changed only once.
CREATE OR REPLACE FUNCTION public.resync_entry_service_categories(_project_ids uuid[] DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT te.id, public.project_service_category(te.project_id) AS category
    FROM public.time_entries te
    WHERE _project_ids IS NULL OR te.project_id = ANY (_project_ids)
  ),
  updated AS (
    UPDATE public.time_entries te
    SET service_category = target.category
    FROM target
    WHERE te.id = target.id
      AND te.service_category IS DISTINCT FROM target.category
      AND NOT (te.va_paid_at IS NOT NULL AND target.category IS NULL)
    RETURNING te.id
  )
  SELECT updated.id FROM updated;
END;
$$;
REVOKE ALL ON FUNCTION public.resync_entry_service_categories(uuid[]) FROM PUBLIC, anon, authenticated;
-- Explicit, so the integration tests' service-role client can call it
-- whatever the project's default function privileges are.
GRANT EXECUTE ON FUNCTION public.resync_entry_service_categories(uuid[]) TO service_role;

-- 4. The four side-effect guards from 20261014000000 skip a write that only
--    changed tag_ids. They now also skip one that only changed
--    service_category, so the bulk re-syncs below don't move entry_date,
--    log an edit per entry or flag approved weeks. Bodies are otherwise
--    copied unchanged from that migration.
CREATE OR REPLACE FUNCTION public.compute_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
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
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
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
    IF (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
     = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
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
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
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

-- 5. An entry's tags and category come from its project. Tags change only
--    when project_id does (an unticked retag keeps old tags on old entries,
--    as before). The category follows the same rule, and in addition any
--    write to the category on its own is replaced by the project's, so no
--    caller can set one directly. A paid entry moved to a project with no
--    category fails time_entries_va_paid_requires_category (23514), which
--    the app turns into a plain message.
CREATE OR REPLACE FUNCTION public.sync_entry_tags_from_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id THEN
    IF NEW.service_category IS DISTINCT FROM OLD.service_category THEN
      NEW.service_category := public.project_service_category(NEW.project_id);
    END IF;
    RETURN NEW;
  END IF;
  NEW.tag_ids := ARRAY(
    SELECT tag_id FROM public.project_tags
    WHERE project_id = NEW.project_id
    ORDER BY tag_id
  );
  NEW.service_category := public.project_service_category(NEW.project_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_entries_sync_tags_from_project ON public.time_entries;
CREATE TRIGGER time_entries_sync_tags_from_project
BEFORE INSERT OR UPDATE OF project_id, service_category ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_entry_tags_from_project();

-- 6. One category tag per project. BEFORE ROW, so a multi-row insert (the
--    project form saves its whole tag set in one statement) sees the rows it
--    inserted before the current one and rejects the second category tag.
CREATE OR REPLACE FUNCTION public.guard_one_category_tag_per_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tags WHERE id = NEW.tag_id AND service_category IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  SELECT t.name INTO _existing
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  WHERE pt.project_id = NEW.project_id
    AND pt.tag_id <> NEW.tag_id
    AND pt.id IS DISTINCT FROM NEW.id
    AND t.service_category IS NOT NULL
  LIMIT 1;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'A project can only have one casual service tag, and this one already has "%".', _existing;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_one_category_tag_per_project() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_tags_one_category_tag ON public.project_tags;
CREATE TRIGGER project_tags_one_category_tag
BEFORE INSERT OR UPDATE ON public.project_tags
FOR EACH ROW EXECUTE FUNCTION public.guard_one_category_tag_per_project();

-- 7. Only admins set or change a tag's category; managers keep every other
--    tag power. RLS can't limit one column for one role, so this is a
--    trigger, like guard_profile_privileged_columns. Not SECURITY DEFINER:
--    current_user has to be the caller's role for the service-role and
--    migration bypass to work. Also refuses a link that would give some
--    project two category tags.
CREATE OR REPLACE FUNCTION public.guard_tag_service_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.service_category IS NOT DISTINCT FROM OLD.service_category THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.service_category IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change what a tag means for billing.'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.service_category IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_tags mine
    JOIN public.project_tags other
      ON other.project_id = mine.project_id AND other.tag_id <> mine.tag_id
    JOIN public.tags other_tag ON other_tag.id = other.tag_id
    WHERE mine.tag_id = NEW.id
      AND other_tag.service_category IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A project can only have one casual service tag, and a project with this tag already has another.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tag_service_category() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tags_guard_service_category ON public.tags;
CREATE TRIGGER tags_guard_service_category
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.guard_tag_service_category();

-- 8. Changing what a tag means re-syncs every entry on its projects, past
--    ones included: an admin changing the mapping is a deliberate billing
--    change. AFTER, so project_service_category() sees the new value.
CREATE OR REPLACE FUNCTION public.resync_entries_for_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM count(*) FROM public.resync_entry_service_categories(
    ARRAY(SELECT project_id FROM public.project_tags WHERE tag_id = NEW.id)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.resync_entries_for_tag() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tags_resync_entry_categories ON public.tags;
CREATE TRIGGER tags_resync_entry_categories
AFTER UPDATE OF service_category ON public.tags
FOR EACH ROW
WHEN (OLD.service_category IS DISTINCT FROM NEW.service_category)
EXECUTE FUNCTION public.resync_entries_for_tag();

-- 9. "Also apply to entries already logged" now carries the category too.
--    The count is entries whose tags or category changed, each counted once.
CREATE OR REPLACE FUNCTION public.retag_project_entries(_project_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tags uuid[];
  _retagged uuid[];
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
  WITH changed AS (
    UPDATE public.time_entries
    SET tag_ids = _tags
    WHERE project_id = _project_id
      AND NOT (tag_ids @> _tags AND tag_ids <@ _tags)
    RETURNING id
  )
  SELECT ARRAY(SELECT id FROM changed) INTO _retagged;
  SELECT count(*) INTO _count
  FROM (
    SELECT unnest(_retagged)
    UNION
    SELECT public.resync_entry_service_categories(ARRAY[_project_id])
  ) AS touched;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.retag_project_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retag_project_entries(uuid) TO authenticated;

-- 10. Deleting a tag clears the category it gave. The project list is read
--     before the delete, because project_tags cascades away with the tag.
CREATE OR REPLACE FUNCTION public.delete_tag(_tag_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _projects uuid[];
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to delete tags.';
  END IF;

  _projects := ARRAY(SELECT project_id FROM public.project_tags WHERE tag_id = _tag_id);

  UPDATE public.time_entries
  SET tag_ids = array_remove(tag_ids, _tag_id)
  WHERE _tag_id = ANY(tag_ids);

  DELETE FROM public.tags WHERE id = _tag_id;

  PERFORM count(*) FROM public.resync_entry_service_categories(_projects);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tag(uuid) TO authenticated;

-- 11. One-off backfill. Link the four tags by name (only ones not linked
--     yet, so a re-run changes nothing), then bring every entry in line with
--     its project. Linking fires section 8 per tag; the final full pass also
--     clears categories on entries whose project has no category tag. If
--     some project already carries two of these tags, section 7 rejects the
--     link and the migration stops: run
--     docs/checks/2026-10-16-category-follows-tag-precheck.sql first.
UPDATE public.tags SET service_category = 'paid_casual'
WHERE lower(name) = lower('Paid Casual Service (Implement)') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'vip_client'
WHERE lower(name) = lower('VIP Client (Clarify)') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'promotional'
WHERE lower(name) = lower('Promotional') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'ironbrij'
WHERE lower(name) = lower('Ironbrij') AND service_category IS NULL;

DO $$
DECLARE
  _changed integer;
  _kept integer;
BEGIN
  SELECT count(*) INTO _changed FROM public.resync_entry_service_categories(NULL);
  SELECT count(*) INTO _kept
  FROM public.time_entries te
  WHERE te.va_paid_at IS NOT NULL
    AND te.service_category IS NOT NULL
    AND public.project_service_category(te.project_id) IS NULL;
  RAISE NOTICE 'Category backfill: % entries changed; % paid entries kept a category their project no longer has.', _changed, _kept;
END;
$$;
