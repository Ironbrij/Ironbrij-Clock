import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceTag } from "./types";

export function useTagsData(enabled: boolean) {
  const qc = useQueryClient();

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
      const { error } = await supabase.from("tags").delete().eq("id", id);
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
