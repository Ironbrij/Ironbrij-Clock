import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dayIndexOf, fromDateKey, toDateKey } from "@/lib/time-utils";
import { throwIf } from "./utils";
import {
  toDbReviewStatus,
  toTimesheetStatus,
  type DbTimesheetStatus,
  type PendingApproval,
  type WorkspaceTimesheet,
} from "./types";

export function useTimesheetsData(enabled: boolean, uid: string | null) {
  const qc = useQueryClient();

  const timesheetsQ = useQuery({
    queryKey: ["timesheets"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheets")
        .select(
          "id, user_id, week_start, status, submitted_at, reviewed_by, reviewed_at, review_note",
        )
        .order("week_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingReviewRaw = useMemo(
    () => (timesheetsQ.data ?? []).filter((t) => t.status === "submitted"),
    [timesheetsQ.data],
  );

  // Only fetched once there's something to review, and scoped to just the
  // people/weeks involved — RLS already limits this to entries the viewer
  // (a manager on a shared team, or an admin) is allowed to see.
  const reviewEntriesQ = useQuery({
    queryKey: [
      "review_entries",
      pendingReviewRaw
        .map((t) => t.id)
        .sort()
        .join(","),
    ],
    enabled: enabled && pendingReviewRaw.length > 0,
    queryFn: async () => {
      const userIds = Array.from(new Set(pendingReviewRaw.map((t) => t.user_id)));
      const earliest = pendingReviewRaw.reduce(
        (min, t) => (t.week_start < min ? t.week_start : min),
        pendingReviewRaw[0].week_start,
      );
      const { data, error } = await supabase
        .from("time_entries")
        .select("user_id, entry_date, duration_minutes")
        .in("user_id", userIds)
        .gte("entry_date", earliest);
      if (error) throw error;
      return data;
    },
  });

  const timesheets = useMemo<WorkspaceTimesheet[]>(
    () =>
      (timesheetsQ.data ?? []).map((t) => ({
        id: t.id,
        userId: t.user_id,
        weekStart: t.week_start,
        status: toTimesheetStatus(t.status as DbTimesheetStatus),
        submittedAt: t.submitted_at,
        reviewedBy: t.reviewed_by,
        reviewedAt: t.reviewed_at,
        reviewNote: t.review_note,
      })),
    [timesheetsQ.data],
  );

  const pendingApprovals = useMemo<PendingApproval[]>(() => {
    const rows = reviewEntriesQ.data ?? [];
    return timesheets
      .filter((t) => t.status === "Submitted")
      .map((t) => {
        const start = fromDateKey(t.weekStart);
        const minutes = rows
          .filter((r) => r.user_id === t.userId)
          .filter((r) => {
            const idx = dayIndexOf(r.entry_date, start);
            return idx >= 0 && idx <= 6;
          })
          .reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
        return { ...t, minutes };
      });
  }, [timesheets, reviewEntriesQ.data]);

  const timesheetForWeek = useCallback(
    (weekStart: Date) => {
      const key = toDateKey(weekStart);
      return timesheets.find((t) => t.userId === uid && t.weekStart === key);
    },
    [timesheets, uid],
  );

  const submitTimesheet = useCallback(
    async (weekStart: Date) => {
      const { error } = await supabase.rpc("submit_timesheet", {
        _week_start: toDateKey(weekStart),
      });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
    [qc],
  );

  const reviewTimesheet = useCallback(
    async (timesheetId: string, status: "Approved" | "Rejected", note?: string) => {
      const { error } = await supabase.rpc("review_timesheet", {
        _timesheet_id: timesheetId,
        _status: toDbReviewStatus(status),
        _note: note,
      });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      qc.invalidateQueries({ queryKey: ["time_entries"] });
      qc.invalidateQueries({ queryKey: ["review_entries"] });
    },
    [qc],
  );

  return {
    timesheetsQ,
    reviewEntriesQ,
    timesheets,
    pendingApprovals,
    timesheetForWeek,
    submitTimesheet,
    reviewTimesheet,
  };
}
