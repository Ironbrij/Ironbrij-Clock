import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceTaskCategory } from "./types";

export function useTaskCategoriesData(enabled: boolean) {
  const qc = useQueryClient();

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["task_categories"] }),
    [qc],
  );

  // L27: a task category added/renamed/removed in another tab used to sit
  // stale until something else triggered a refetch.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("task_categories_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_categories" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, invalidate]);

  const taskCategoriesQ = useQuery({
    queryKey: ["task_categories"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_categories")
        .select("id, name")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const taskCategories = useMemo<WorkspaceTaskCategory[]>(
    () => (taskCategoriesQ.data ?? []).map((t) => ({ id: t.id, name: t.name })),
    [taskCategoriesQ.data],
  );

  const createTaskCategory = useCallback(
    async (name: string) => {
      const { error } = await supabase.from("task_categories").insert({ name: name.trim() });
      throwIf(error, { "23505": "A task category with that name already exists." });
      invalidate();
    },
    [invalidate],
  );

  const updateTaskCategory = useCallback(
    async (id: string, name: string) => {
      const { error } = await supabase
        .from("task_categories")
        .update({ name: name.trim() })
        .eq("id", id);
      throwIf(error, { "23505": "A task category with that name already exists." });
      invalidate();
    },
    [invalidate],
  );

  const deleteTaskCategory = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("task_categories").delete().eq("id", id);
      throwIf(error);
      invalidate();
    },
    [invalidate],
  );

  return {
    taskCategoriesQ,
    taskCategories,
    createTaskCategory,
    updateTaskCategory,
    deleteTaskCategory,
  };
}
