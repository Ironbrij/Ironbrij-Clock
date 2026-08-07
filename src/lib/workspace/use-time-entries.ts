import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { combineDateAndTime, toDateKey } from "@/lib/time-utils";
import { throwIf } from "./utils";
import type { WorkspaceEntry, WorkspaceProject } from "./types";

type TimeEntryUpdate = Database["public"]["Tables"]["time_entries"]["Update"];

export function useTimeEntriesData(
  enabled: boolean,
  uid: string | null,
  projects: WorkspaceProject[],
) {
  const qc = useQueryClient();

  const entriesQ = useQuery({
    queryKey: ["time_entries", uid],
    enabled,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 60);
      const { data, error } = await supabase
        .from("time_entries")
        .select(
          "id, project_id, task, description, start_time, end_time, entry_date, duration_minutes, is_billable",
        )
        .eq("user_id", uid!)
        .gte("entry_date", toDateKey(from))
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const entries = useMemo<WorkspaceEntry[]>(
    () =>
      (entriesQ.data ?? []).map((e) => ({
        id: e.id,
        projectId: e.project_id,
        task: e.task ?? "",
        description: e.description,
        minutes: e.duration_minutes ?? 0,
        startTime: e.start_time,
        endTime: e.end_time,
        date: e.entry_date,
        running: !e.end_time,
      })),
    [entriesQ.data],
  );

  const runningEntry = useMemo(() => entries.find((e) => e.running) ?? null, [entries]);

  const invalidateEntries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["time_entries"] });
    qc.invalidateQueries({ queryKey: ["project_hours"] });
    qc.invalidateQueries({ queryKey: ["tag_usage"] });
  }, [qc]);

  const startTimer = useCallback(
    async ({
      projectId,
      task,
      description,
    }: {
      projectId: string;
      task: string;
      description: string;
    }) => {
      if (!uid) return;
      const project = projects.find((p) => p.id === projectId);
      const now = new Date();
      const { error } = await supabase.from("time_entries").insert({
        user_id: uid,
        project_id: projectId,
        task,
        description,
        start_time: now.toISOString(),
        entry_date: toDateKey(now),
        is_billable: project?.billable ?? true,
        tag_ids: project?.tagIds ?? [],
      });
      throwIf(error);
      invalidateEntries();
    },
    [uid, projects, invalidateEntries],
  );

  const stopTimer = useCallback(
    async (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return;
      const end = new Date();
      const minutes = Math.max(
        1,
        Math.round((end.getTime() - new Date(entry.startTime).getTime()) / 60000),
      );
      const { error } = await supabase
        .from("time_entries")
        .update({ end_time: end.toISOString(), duration_minutes: minutes })
        .eq("id", entryId);
      throwIf(error);
      invalidateEntries();
    },
    [entries, invalidateEntries],
  );

  const updateEntry = useCallback(
    async (
      entryId: string,
      patch: {
        projectId?: string;
        task?: string;
        description?: string;
        date?: string;
        startTime?: string;
        endTime?: string;
      },
    ) => {
      const dbPatch: TimeEntryUpdate = {};
      if (patch.projectId !== undefined) dbPatch.project_id = patch.projectId;
      if (patch.task !== undefined) dbPatch.task = patch.task;
      if (patch.description !== undefined) dbPatch.description = patch.description;

      if (
        patch.date !== undefined ||
        patch.startTime !== undefined ||
        patch.endTime !== undefined
      ) {
        const existing = entries.find((e) => e.id === entryId);
        if (!existing) throw new Error("Entry not found.");
        const date = patch.date ?? existing.date;
        const existingStart = new Date(existing.startTime);
        const existingEnd = existing.endTime ? new Date(existing.endTime) : existingStart;
        const pad = (n: number) => String(n).padStart(2, "0");
        const startTime =
          patch.startTime ?? `${pad(existingStart.getHours())}:${pad(existingStart.getMinutes())}`;
        const endTime =
          patch.endTime ?? `${pad(existingEnd.getHours())}:${pad(existingEnd.getMinutes())}`;
        const start = combineDateAndTime(date, startTime);
        const end = combineDateAndTime(date, endTime);
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        if (minutes <= 0) throw new Error("End time must be after start time.");
        dbPatch.entry_date = date;
        dbPatch.start_time = start.toISOString();
        dbPatch.end_time = end.toISOString();
        dbPatch.duration_minutes = minutes;
      }

      const { error } = await supabase.from("time_entries").update(dbPatch).eq("id", entryId);
      throwIf(error);
      invalidateEntries();
    },
    [entries, invalidateEntries],
  );

  const createEntry = useCallback(
    async (input: {
      projectId: string;
      task: string;
      description: string;
      date: string;
      startTime: string;
      endTime: string;
    }) => {
      if (!uid) return;
      const project = projects.find((p) => p.id === input.projectId);
      const start = combineDateAndTime(input.date, input.startTime);
      const end = combineDateAndTime(input.date, input.endTime);
      const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
      if (minutes <= 0) throw new Error("End time must be after start time.");
      const { error } = await supabase.from("time_entries").insert({
        user_id: uid,
        project_id: input.projectId,
        task: input.task,
        description: input.description,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entry_date: input.date,
        duration_minutes: minutes,
        is_billable: project?.billable ?? true,
        tag_ids: project?.tagIds ?? [],
      });
      throwIf(error);
      invalidateEntries();
    },
    [uid, projects, invalidateEntries],
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      const { error } = await supabase.from("time_entries").delete().eq("id", entryId);
      throwIf(error);
      invalidateEntries();
    },
    [invalidateEntries],
  );

  const entriesForTag = useCallback(async (tagId: string) => {
    const { data, error } = await supabase
      .from("time_entries")
      .select("id, user_id, project_id, description, entry_date, duration_minutes")
      .contains("tag_ids", [tagId])
      .order("entry_date", { ascending: false })
      .limit(200);
    throwIf(error);
    return (data ?? []).map((e) => ({
      id: e.id,
      userId: e.user_id,
      projectId: e.project_id,
      description: e.description,
      date: e.entry_date,
      minutes: e.duration_minutes ?? 0,
    }));
  }, []);

  return {
    entriesQ,
    entries,
    runningEntry,
    startTimer,
    stopTimer,
    updateEntry,
    createEntry,
    deleteEntry,
    entriesForTag,
  };
}
