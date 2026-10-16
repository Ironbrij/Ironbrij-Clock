-- Fix for 20261016000000_category_follows_project_tag.sql's tag guard.
--
-- guard_tag_service_category() checked "signed-in caller AND not an admin" as
-- one condition:
--
--   IF current_user IN ('authenticated', 'anon')
--      AND NOT public.has_role(auth.uid(), 'admin') THEN
--
-- Postgres checks EXECUTE on every function in an expression when it sets the
-- expression up, before AND gets a chance to short-circuit. has_role() is
-- granted to authenticated only, and this trigger runs as the caller (it
-- can't be SECURITY DEFINER, or current_user would always be the owner), so
-- any service-role write that sets a tag's category failed with "permission
-- denied for function has_role" instead of being let through. The app's own
-- admins sign in as authenticated and the migrations run as the owner, so
-- neither was affected; the integration tests' service-role fixtures were.
--
-- The has_role() call now sits inside its own IF, so it is only ever set up
-- for a signed-in caller. Everything else is unchanged, including the
-- one-category-tag-per-project check, which still runs for every caller.
CREATE OR REPLACE FUNCTION public.guard_tag_service_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.service_category IS NOT DISTINCT FROM OLD.service_category THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.service_category IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon') THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only admins can change what a tag means for billing.'
        USING ERRCODE = '42501';
    END IF;
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
