-- Announcements: admins and managers can broadcast a note to either the
-- whole workspace or specific team(s); every workspace member can read
-- whatever's targeted at them; posting also emails the audience via the
-- same SendGrid path M29 established (see notify-announcement-posted).
--
-- All writes go through create_announcement() below rather than direct
-- client inserts — same reasoning as submit_timesheet()/stop_timer(): the
-- "which teams" business rule (an admin may target everyone, a manager
-- may only target team(s) they actually belong to) needs to be checked
-- atomically against both tables in one place, not split across two RLS
-- policies that could drift out of sync with each other.
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('everyone', 'teams')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.announcement_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  UNIQUE (announcement_id, team_id)
);

GRANT SELECT, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
GRANT SELECT ON public.announcement_teams TO authenticated;
GRANT ALL ON public.announcement_teams TO service_role;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_teams ENABLE ROW LEVEL SECURITY;

-- Readable by: everyone (for an 'everyone' announcement), the author, any
-- admin (oversight, same as every other table in this app), or anyone on
-- a targeted team. No direct INSERT/UPDATE policy on either table — see
-- create_announcement() below, which is the only way rows are written.
CREATE POLICY "announcements_select" ON public.announcements FOR SELECT TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (
      audience = 'everyone'
      OR author_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.announcement_teams at
        JOIN public.team_members tm ON tm.team_id = at.team_id
        WHERE at.announcement_id = announcements.id AND tm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "announcements_delete" ON public.announcements FOR DELETE TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND (author_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  );

-- Read-open, same shape as project_task_categories (M25) — team names are
-- already visible workspace-wide (the Teams page), so there's no
-- confidentiality reason to scope who can see which team an announcement
-- targets, only who can see the announcement's content itself (handled by
-- announcements_select's own EXISTS check above).
CREATE POLICY "announcement_teams_select" ON public.announcement_teams FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.create_announcement(
  _title text,
  _body text,
  _audience text,
  _team_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _is_admin boolean := public.has_role(auth.uid(), 'admin');
  _is_manager boolean := public.has_role(auth.uid(), 'manager');
  _id uuid;
  _tid uuid;
BEGIN
  IF NOT (_is_admin OR _is_manager) THEN
    RAISE EXCEPTION 'Only admins and managers can post announcements';
  END IF;
  IF _audience NOT IN ('everyone', 'teams') THEN
    RAISE EXCEPTION 'Invalid audience';
  END IF;
  IF _audience = 'everyone' AND NOT _is_admin THEN
    RAISE EXCEPTION 'Only admins can post to everyone';
  END IF;
  IF _audience = 'teams' THEN
    IF _team_ids IS NULL OR array_length(_team_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Select at least one team';
    END IF;
    IF NOT _is_admin THEN
      FOREACH _tid IN ARRAY _team_ids LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.team_members WHERE team_id = _tid AND user_id = auth.uid()
        ) THEN
          RAISE EXCEPTION 'You can only post to teams you belong to';
        END IF;
      END LOOP;
    END IF;
  END IF;

  INSERT INTO public.announcements (author_id, title, body, audience)
  VALUES (auth.uid(), _title, _body, _audience)
  RETURNING id INTO _id;

  IF _audience = 'teams' THEN
    INSERT INTO public.announcement_teams (announcement_id, team_id)
    SELECT _id, unnest(_team_ids);
  END IF;

  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_announcement(text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_announcement(text, text, text, uuid[]) TO authenticated;

-- Backs notify-announcement-posted (supabase/functions/) — same
-- ownership-reverification pattern as timesheet_submission_recipients()
-- (20260825090000): only ever returns recipients for an announcement the
-- caller actually authored, so this can't be used to harvest another
-- team's email addresses via a guessed id. title/body/author_name are
-- denormalized onto every row for the same reason as that function's
-- week_start/submitter_name — the edge function never has to trust a
-- client-supplied display string.
CREATE OR REPLACE FUNCTION public.announcement_recipients(_announcement_id uuid)
RETURNS TABLE (email text, full_name text, title text, body text, author_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _audience text;
  _title text;
  _body text;
  _author_name text;
BEGIN
  SELECT a.audience, a.title, a.body, COALESCE(p.full_name, p.email)
    INTO _audience, _title, _body, _author_name
  FROM public.announcements a
  JOIN public.profiles p ON p.id = a.author_id
  WHERE a.id = _announcement_id AND a.author_id = auth.uid();

  IF _audience IS NULL THEN
    RETURN;
  END IF;

  IF _audience = 'everyone' THEN
    RETURN QUERY
    SELECT p.email, p.full_name, _title, _body, _author_name
    FROM public.profiles p
    WHERE p.id <> auth.uid() AND p.is_active AND NOT p.is_pending AND p.email IS NOT NULL;
  ELSE
    RETURN QUERY
    SELECT DISTINCT p.email, p.full_name, _title, _body, _author_name
    FROM public.profiles p
    JOIN public.team_members tm ON tm.user_id = p.id
    JOIN public.announcement_teams at ON at.team_id = tm.team_id
    WHERE at.announcement_id = _announcement_id
      AND p.id <> auth.uid() AND p.is_active AND NOT p.is_pending AND p.email IS NOT NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.announcement_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_recipients(uuid) TO authenticated;

-- L27-style Realtime coverage — same guarded pattern as
-- 20260812090000_enable_realtime_workspace_tables.sql, so a new
-- announcement posted in one tab/device shows up live everywhere else.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'announcement_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_teams;
  END IF;
END $$;
