-- M35: deleteTag only ever ran DELETE FROM tags WHERE id = id — project_tags
-- cleaned up correctly via its own ON DELETE CASCADE, but
-- time_entries.tag_ids (a plain uuid[], not a real foreign key Postgres
-- can cascade through) never got touched. Every entry that carried the
-- deleted tag kept the now-dangling id in its array permanently, with no
-- admin tooling able to see or clean it up.
--
-- Fixed with a SECURITY DEFINER RPC that does both writes in one call:
-- strips the id from every entry's tag_ids first, then deletes the tag
-- itself (project_tags' cascade still handles that side). A plain
-- can_manage() check up front replicates tags_write_manage's own RLS
-- policy exactly (can_manage() already folds in is_active_user per H15),
-- since this has to bypass RLS to reach every user's time_entries rows
-- workspace-wide, not just rows the caller could update directly under
-- shares_team() scoping.
CREATE OR REPLACE FUNCTION public.delete_tag(_tag_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to delete tags.';
  END IF;

  UPDATE public.time_entries
  SET tag_ids = array_remove(tag_ids, _tag_id)
  WHERE _tag_id = ANY(tag_ids);

  DELETE FROM public.tags WHERE id = _tag_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tag(uuid) TO authenticated;
