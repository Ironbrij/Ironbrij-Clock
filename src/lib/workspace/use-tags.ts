import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { CasualServiceCategory, WorkspaceTag } from "./types";

/** Changing what a tag means for billing is admin-only — the DB's guard_tag_service_category() is the backstop. */
const ADMIN_ONLY_CATEGORY_MESSAGE = "Only admins can change what a tag means for billing.";

export function useTagsData(enabled: boolean, isAdmin: boolean) {
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
      // "*" rather than a column list: if this deploys a moment before
      // 20261016000000 adds service_category, a named column would fail the
      // whole query and empty the Tags tab.
      const { data, error } = await supabase.from("tags").select("*").order("name");
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
      serviceCategory: t.service_category ?? null,
    }));
  }, [tagsQ.data, tagUsageQ.data]);

  const createTag = useCallback(
    async (name: string, color: string, serviceCategory: CasualServiceCategory | null = null) => {
      if (serviceCategory !== null && !isAdmin) throw new Error(ADMIN_ONLY_CATEGORY_MESSAGE);
      const { error } = await supabase
        .from("tags")
        .insert({ name: name.trim(), color, service_category: serviceCategory });
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    [qc, isAdmin],
  );

  const updateTag = useCallback(
    async (
      id: string,
      name: string,
      color: string,
      // Omitted = leave it as it is. Never defaulted to null: that would let
      // a caller that doesn't know about categories wipe one out.
      serviceCategory?: CasualServiceCategory | null,
    ) => {
      const current = tagsQ.data?.find((t) => t.id === id);
      const categoryChanged =
        serviceCategory !== undefined && (current?.service_category ?? null) !== serviceCategory;
      if (categoryChanged && !isAdmin) throw new Error(ADMIN_ONLY_CATEGORY_MESSAGE);
      const { error } = await supabase
        .from("tags")
        .update({
          name: name.trim(),
          color,
          ...(serviceCategory !== undefined ? { service_category: serviceCategory } : {}),
        })
        .eq("id", id);
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
      // A changed category re-syncs entries on every project with this tag.
      if (categoryChanged) qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
    [qc, isAdmin, tagsQ.data],
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
      // Deleting a category tag clears its entries' categories.
      qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
    [qc],
  );

  return { tagsQ, tagUsageQ, tags, createTag, updateTag, deleteTag };
}
