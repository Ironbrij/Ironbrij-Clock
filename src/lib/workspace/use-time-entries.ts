import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { combineDateAndTime, toDateKey } from "@/lib/time-utils";
import { throwIf } from "./utils";
import type { WorkspaceEntry, WorkspaceProject } from "./types";

type TimeEntryUpdate = Database["public"]["Tables"]["time_entries"]["Update"];

const LOCKED_WEEK_MESSAGE =
  "This week is locked because it's been submitted or approved — ask your manager to send it back if you need to make changes.";

/** True if [start, end) would overlap any of `entries` other than `excludeId` — a still-running entry (no end_time yet) is treated as open-ended. */
function overlapsExisting(
  entries: WorkspaceEntry[],
  start: Date,
  end: Date,
  excludeId?: string,
): boolean {
  const newStart = start.getTime();
  const newEnd = end.getTime();
  return entries.some((e) => {
    if (e.id === excludeId) return false;
    const eStart = new Date(e.startTime).getTime();
    const eEnd = e.endTime ? new Date(e.endTime).getTime() : Infinity;
    return newStart < eEnd && eStart < newEnd;
  });
}

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
      // Re-check against the freshest known entries, not just whatever
      // state the caller happened to have — a stale tab (or a second
      // device) can believe nothing's running when it actually is. The
      // one_running_per_user DB index is the real backstop; this just
      // gives an instant, friendly error instead of a round trip.
      if (entries.some((e) => e.running)) {
        throw new Error(
          "You already have a timer running — stop it before starting another.",
        );
      }
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
      throwIf(error, {
        "23505": "You already have a timer running — stop it before starting another.",
        "42501": LOCKED_WEEK_MESSAGE,
      });
      invalidateEntries();
    },
    [uid, projects, entries, invalidateEntries],
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
      // A locked week doesn't make an UPDATE error — Postgres RLS just
      // excludes the row from the USING clause, so this would otherwise
      // report success while changing nothing. .select() plus checking for
      // an empty result is what turns that silent no-op into a real error.
      const { data, error } = await supabase
        .from("time_entries")
        .update({ end_time: end.toISOString(), duration_minutes: minutes })
        .eq("id", entryId)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) throw new Error(LOCKED_WEEK_MESSAGE);
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
        if (overlapsExisting(entries, start, end, entryId)) {
          throw new Error("That overlaps with another entry you already have on this day.");
        }
        dbPatch.entry_date = date;
        dbPatch.start_time = start.toISOString();
        dbPatch.end_time = end.toISOString();
        dbPatch.duration_minutes = minutes;
      }

      // Same silent-no-op risk as stopTimer: if entryId's week (old or new,
      // whichever the row currently has) is locked, this UPDATE matches
      // zero rows rather than erroring — .select() + the length check below
      // is what catches that.
      const { data, error } = await supabase
        .from("time_entries")
        .update(dbPatch)
        .eq("id", entryId)
        .select("id");
      throwIf(error, {
        "23P01": "That overlaps with another entry you already have on this day.",
        "42501": LOCKED_WEEK_MESSAGE,
      });
      if (!data || data.length === 0) throw new Error(LOCKED_WEEK_MESSAGE);
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
      if (overlapsExisting(entries, start, end)) {
        throw new Error("That overlaps with another entry you already have on this day.");
      }
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
      throwIf(error, {
        "23P01": "That overlaps with another entry you already have on this day.",
        "42501": LOCKED_WEEK_MESSAGE,
      });
      invalidateEntries();
    },
    [uid, projects, entries, invalidateEntries],
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      // Deleting a row a locked week excludes from the DELETE policy's
      // USING clause is the same silent-no-op case as stopTimer/updateEntry.
      const { data, error } = await supabase
        .from("time_entries")
        .delete()
        .eq("id", entryId)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) throw new Error(LOCKED_WEEK_MESSAGE);
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
