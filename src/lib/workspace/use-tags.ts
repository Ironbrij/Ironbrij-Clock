import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceTag } from "./types";

export function useTagsData(enabled: boolean) {
  const qc = useQueryClient();

  // L27: a tag rename/recolor/delete made in another tab used to sit stale
  // until something else triggered a refetch. tag_usage's own count
  // already refreshes live via time_entries' existing subscription
  // (use-time-entries.ts invalidates ["tag_usage"] on every change), so
  // this only needs to cover the tags table itself.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("tags_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, () =>
        qc.invalidateQueries({ queryKey: ["tags"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  const tagsQ = useQuery({
    queryKey: ["tags"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("tags").select("id, name, color").order("name");
      if (error) throw error;
      return data;
    },
  });

  const tagUsageQ = useQuery({
    queryKey: ["tag_usage"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tag_usage");
      if (error) throw error;
      return data;
    },
  });

  const tags = useMemo<WorkspaceTag[]>(() => {
    const usage = tagUsageQ.data ?? [];
    return (tagsQ.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      entryCount: usage.find((u) => u.tag_id === t.id)?.entry_count ?? 0,
    }));
  }, [tagsQ.data, tagUsageQ.data]);

  const createTag = useCallback(
    async (name: string, color: string) => {
      const { error } = await supabase.from("tags").insert({ name: name.trim(), color });
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    [qc],
  );

  const updateTag = useCallback(
    async (id: string, name: string, color: string) => {
      const { error } = await supabase
        .from("tags")
        .update({ name: name.trim(), color })
        .eq("id", id);
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    [qc],
  );

  const deleteTag = useCallback(
    async (id: string) => {
      // M35: delete_tag() strips the id from every entry's tag_ids first,
      // then deletes the tag itself, in one transaction — a plain
      // DELETE FROM tags left every historical entry's array carrying a
      // permanently dangling id, since tag_ids is a plain uuid[], not a
      // real foreign key Postgres could cascade through.
      const { error } = await supabase.rpc("delete_tag", { _tag_id: id });
      throwIf(error);
      // Deleting a tag affects project_tags (cascade) and tag_usage counts
      // too, not just the tags list itself.
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tag_usage"] });
    },
    [qc],
  );

  return { tagsQ, tagUsageQ, tags, createTag, updateTag, deleteTag };
}
