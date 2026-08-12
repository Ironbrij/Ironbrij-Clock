import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  addDays,
  combineDateAndTime,
  ENTRIES_HISTORY_DAYS,
  splitByDay,
  toDateKey,
} from "@/lib/time-utils";
import { throwIf } from "./utils";
import type { WorkspaceEntry, WorkspaceProject, WorkspaceSettings } from "./types";

type TimeEntryUpdate = Database["public"]["Tables"]["time_entries"]["Update"];
type TimeEntryRow = {
  id: string;
  project_id: string | null;
  task: string | null;
  description: string;
  start_time: string;
  end_time: string | null;
  entry_date: string;
  duration_minutes: number | null;
};

function mapEntryRow(e: TimeEntryRow): WorkspaceEntry {
  return {
    id: e.id,
    projectId: e.project_id,
    task: e.task ?? "",
    description: e.description,
    minutes: e.duration_minutes ?? 0,
    startTime: e.start_time,
    endTime: e.end_time,
    date: e.entry_date,
    running: !e.end_time,
  };
}

const LOCKED_WEEK_MESSAGE =
  "This week is locked because it's been submitted or approved — ask your manager to send it back if you need to make changes.";

const REQUIRE_DESCRIPTION_MESSAGE =
  "Add a description first — your admin has made descriptions required.";

const MANUAL_ENTRY_DISABLED_MESSAGE =
  "Your admin has turned off manual time entry — use the timer instead.";

// The DB enforces the same rules (see the enforce_entry_policies migration)
// as a backstop against a direct API call bypassing the checks below, but
// a single RLS violation code can't say which of several WITH CHECK
// clauses failed — this covers all of them rather than asserting a
// specific (possibly wrong) cause.
const POLICY_VIOLATION_MESSAGE =
  "That couldn't be saved — check that this week isn't locked, that manual entries are still allowed, and that a description is included if your admin requires one.";

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
  settings: WorkspaceSettings,
) {
  const qc = useQueryClient();

  const entriesQ = useQuery({
    queryKey: ["time_entries", uid],
    enabled,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - ENTRIES_HISTORY_DAYS);
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
    () => (entriesQ.data ?? []).map(mapEntryRow),
    [entriesQ.data],
  );

  const runningEntry = useMemo(() => entries.find((e) => e.running) ?? null, [entries]);

  const invalidateEntries = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["time_entries"] });
    qc.invalidateQueries({ queryKey: ["project_hours"] });
    qc.invalidateQueries({ queryKey: ["tag_usage"] });
    // updateEntry/deleteEntry are also what Manage > Entries uses for a
    // manager/admin editing someone else's entry — refresh that view too.
    qc.invalidateQueries({ queryKey: ["member_entries"] });
  }, [qc]);

  // A second tab, a second device, or a manager acting on this person's
  // behalf can all change these rows without this tab lifting a finger —
  // without this, "is my timer running" only ever updated on the next
  // window refocus. Filtered to this user's own rows: that's the only
  // slice of time_entries this hook ever fetches anyway.
  useEffect(() => {
    if (!enabled || !uid) return;
    const channel = supabase
      .channel(`time_entries_${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_entries", filter: `user_id=eq.${uid}` },
        () => invalidateEntries(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, uid, invalidateEntries]);

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
      if (settings.requireDescriptions && !description.trim()) {
        throw new Error(REQUIRE_DESCRIPTION_MESSAGE);
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
        "42501": POLICY_VIOLATION_MESSAGE,
      });
      invalidateEntries();
    },
    [uid, projects, entries, settings, invalidateEntries],
  );

  const stopTimer = useCallback(
    async (entryId: string): Promise<{ splitAcrossDays: boolean }> => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry || !uid) return { splitAcrossDays: false };
      const [firstSegment, ...laterSegments] = splitByDay(new Date(entry.startTime), new Date());
      const splitAcrossDays = laterSegments.length > 0;

      // Insert any later-day segments *before* touching the original row —
      // if one of these fails partway through (e.g. it collides with
      // another entry someone added for the new day while this timer was
      // still running), the original entry is left exactly as it was:
      // still running and visible, not silently missing time.
      if (splitAcrossDays) {
        const project = projects.find((p) => p.id === entry.projectId);
        for (const seg of laterSegments) {
          const { error } = await supabase.from("time_entries").insert({
            user_id: uid,
            project_id: entry.projectId,
            task: entry.task,
            description: entry.description,
            start_time: seg.start.toISOString(),
            end_time: seg.end.toISOString(),
            entry_date: seg.date,
            duration_minutes: Math.max(1, seg.minutes),
            is_billable: project?.billable ?? true,
            tag_ids: project?.tagIds ?? [],
          });
          throwIf(error, {
            "23P01": "That overlaps with another entry you already have on this day.",
            "42501": POLICY_VIOLATION_MESSAGE,
          });
        }
      }

      // A locked week doesn't make an UPDATE error — Postgres RLS just
      // excludes the row from the USING clause, so this would otherwise
      // report success while changing nothing. .select() plus checking for
      // an empty result is what turns that silent no-op into a real error.
      const { data, error } = await supabase
        .from("time_entries")
        .update({
          end_time: firstSegment.end.toISOString(),
          duration_minutes: Math.max(1, firstSegment.minutes),
        })
        .eq("id", entryId)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) throw new Error(LOCKED_WEEK_MESSAGE);
      invalidateEntries();
      return { splitAcrossDays };
    },
    [entries, uid, projects, invalidateEntries],
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
      if (
        patch.description !== undefined &&
        settings.requireDescriptions &&
        !patch.description.trim()
      ) {
        throw new Error(REQUIRE_DESCRIPTION_MESSAGE);
      }

      const dbPatch: TimeEntryUpdate = {};
      if (patch.projectId !== undefined) dbPatch.project_id = patch.projectId;
      if (patch.task !== undefined) dbPatch.task = patch.task;
      if (patch.description !== undefined) dbPatch.description = patch.description;

      if (
        patch.date !== undefined ||
        patch.startTime !== undefined ||
        patch.endTime !== undefined
      ) {
        // `entries` here is only ever the signed-in caller's own rows — for
        // a self-edit that's the entry being edited, but for a manager/
        // admin editing someone else's entry (Manage > Entries), it never
        // is. Only look the entry up in `entries` when a gap actually needs
        // filling from it; a caller (like EntryFormDialog) that already
        // supplies date/startTime/endTime in full never needs that lookup,
        // so it can't wrongly 404 on an entry that just isn't the caller's.
        const needsExisting =
          patch.date === undefined || patch.startTime === undefined || patch.endTime === undefined;
        const existing = needsExisting ? entries.find((e) => e.id === entryId) : undefined;
        if (needsExisting && !existing) throw new Error("Entry not found.");
        // A running entry (no end_time) has no real "end" to fall back to —
        // defaulting it to the start, as this used to, silently forced
        // minutes to 0 and surfaced as the misleading "End time must be
        // after start time." No UI reaches this today (edit is hidden while
        // running), but the function is public, so guard it directly.
        if (existing && !existing.endTime) {
          throw new Error("Stop the timer before changing its date or time.");
        }

        const pad = (n: number) => String(n).padStart(2, "0");
        const existingStart = existing ? new Date(existing.startTime) : null;
        const existingEnd = existing?.endTime ? new Date(existing.endTime) : null;
        const date = patch.date ?? existing?.date;
        const startTime =
          patch.startTime ??
          (existingStart &&
            `${pad(existingStart.getHours())}:${pad(existingStart.getMinutes())}`);
        const endTime =
          patch.endTime ??
          (existingEnd && `${pad(existingEnd.getHours())}:${pad(existingEnd.getMinutes())}`);
        if (!date || !startTime || !endTime) throw new Error("Entry not found.");

        const start = combineDateAndTime(date, startTime);
        const end = combineDateAndTime(date, endTime);
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        if (minutes <= 0) throw new Error("End time must be after start time.");
        // Only meaningful for the caller's own entry — for someone else's
        // (existing is undefined in that case), `entries` can't answer
        // "does this overlap," so this is skipped and the DB's EXCLUDE
        // constraint (mapped to a friendly message below) is the real check.
        if (existing && overlapsExisting(entries, start, end, entryId)) {
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
        "42501": POLICY_VIOLATION_MESSAGE,
      });
      if (!data || data.length === 0) throw new Error(LOCKED_WEEK_MESSAGE);
      invalidateEntries();
    },
    [entries, settings, invalidateEntries],
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
      if (!settings.allowManualEntry) {
        throw new Error(MANUAL_ENTRY_DISABLED_MESSAGE);
      }
      if (settings.requireDescriptions && !input.description.trim()) {
        throw new Error(REQUIRE_DESCRIPTION_MESSAGE);
      }
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
        "42501": POLICY_VIOLATION_MESSAGE,
      });
      invalidateEntries();
    },
    [uid, projects, entries, settings, invalidateEntries],
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

/**
 * One specific person's entries for one week — separate from the
 * signed-in-only `entries` above, for Manage > Entries (H11: a manager/
 * admin viewing or editing an individual team member's time). RLS on
 * time_entries already scopes this to admin (anyone) or manager (shared
 * team only); `enabled` should additionally gate on canManage so a Member
 * doesn't even issue the query (it would just come back empty).
 */
export function useMemberEntriesData(enabled: boolean, userId: string | null, weekStart: Date) {
  const from = toDateKey(weekStart);
  const to = toDateKey(addDays(weekStart, 6));

  const entriesQ = useQuery({
    queryKey: ["member_entries", userId, from],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(
          "id, project_id, task, description, start_time, end_time, entry_date, duration_minutes, is_billable",
        )
        .eq("user_id", userId!)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const entries = useMemo<WorkspaceEntry[]>(
    () => (entriesQ.data ?? []).map(mapEntryRow),
    [entriesQ.data],
  );

  return { entriesQ, entries };
}

export type ActiveTimer = {
  entryId: string;
  userId: string;
  projectId: string | null;
  task: string;
  description: string;
  startTime: string;
};

/**
 * M18: forgotten clock-outs previously had no server-side visibility at
 * all — only a client-side setInterval warning the owner's own tab showed
 * itself. This doesn't auto-stop anything (that's a real policy decision,
 * not made here); it just gives a manager/admin passive visibility into
 * every currently-running timer RLS lets them see (admin: everyone;
 * manager: shared-team only), same as everywhere else in this app. Polls
 * every minute so a manager who leaves this open actually notices a new
 * or still-running timer without a manual refresh.
 */
export function useActiveTimersData(enabled: boolean) {
  const activeTimersQ = useQuery({
    queryKey: ["active_timers"],
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id, user_id, project_id, task, description, start_time")
        .is("end_time", null)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const activeTimers = useMemo<ActiveTimer[]>(
    () =>
      (activeTimersQ.data ?? []).map((e) => ({
        entryId: e.id,
        userId: e.user_id,
        projectId: e.project_id,
        task: e.task ?? "",
        description: e.description,
        startTime: e.start_time,
      })),
    [activeTimersQ.data],
  );

  return { activeTimersQ, activeTimers };
}
