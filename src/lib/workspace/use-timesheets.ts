import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dayIndexOf, fromDateKey, oldestLoadedWeekStart, toDateKey } from "@/lib/time-utils";
import { throwIf } from "./utils";
import {
  toDbReviewStatus,
  toTimesheetStatus,
  type DbTimesheetStatus,
  type PendingApproval,
  type PendingApprovalEntry,
  type WorkspaceTimesheet,
} from "./types";

export function useTimesheetsData(enabled: boolean, uid: string | null, canManage: boolean) {
  const qc = useQueryClient();

  const timesheetsQ = useQuery({
    queryKey: ["timesheets"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheets")
        .select(
          "id, user_id, week_start, status, submitted_at, reviewed_by, reviewed_at, review_note, entries_modified_at",
        )
        // M41: unbounded before this — for an admin, every timesheet ever
        // submitted workspace-wide, forever, growing by active_members × 52
        // rows a year with no cap. Bounded to the same rolling window
        // `entries` itself already uses (oldestLoadedWeekStart /
        // ENTRIES_HISTORY_DAYS) — nothing in the app shows or acts on a
        // timesheet older than that boundary anyway, since Timesheet's own
        // week-nav already refuses to page any further back (H10/L22).
        .gte("week_start", toDateKey(oldestLoadedWeekStart()))
        .order("week_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Unfiltered on purpose, unlike time_entries' own subscription: a
  // manager needs to hear about a team member's brand-new submission
  // (a different user_id than their own), not just their own row
  // changing. No client-side filter can express "any row RLS lets me
  // see," so this relies on Realtime enforcing the same timesheets_select
  // policy server-side — each subscriber only ever receives events for
  // rows they're actually allowed to read.
  useEffect(() => {
    if (!enabled || !uid) return;
    const channel = supabase
      .channel(`timesheets_${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "timesheets" }, () =>
        qc.invalidateQueries({ queryKey: ["timesheets"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, uid, qc]);

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
        .select(
          "id, user_id, project_id, task, description, entry_date, start_time, duration_minutes",
        )
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
        entriesModifiedAt: t.entries_modified_at,
      })),
    [timesheetsQ.data],
  );

  // The rows (from reviewEntriesQ) that belong to a given timesheet's
  // person + week — shared by both the approval total and the per-entry
  // breakdown so they can never disagree with each other.
  const rowsForTimesheet = useCallback(
    (t: WorkspaceTimesheet) => {
      const start = fromDateKey(t.weekStart);
      return (reviewEntriesQ.data ?? [])
        .filter((r) => r.user_id === t.userId)
        .filter((r) => {
          const idx = dayIndexOf(r.entry_date, start);
          return idx >= 0 && idx <= 6;
        });
    },
    [reviewEntriesQ.data],
  );

  const pendingApprovals = useMemo<PendingApproval[]>(
    () =>
      timesheets
        // A reviewer can never review their own timesheet (see
        // review_timesheet's server-side self-check) — hiding it here too
        // means the Approvals queue never even offers the button.
        .filter((t) => t.status === "Submitted" && t.userId !== uid)
        .map((t) => {
          const minutes = rowsForTimesheet(t).reduce(
            (sum, r) => sum + (r.duration_minutes ?? 0),
            0,
          );
          return { ...t, minutes };
        }),
    [timesheets, uid, rowsForTimesheet],
  );

  /** The actual entries behind a pending approval's total, so a reviewer can see what they're approving instead of just a number. */
  const entriesForApproval = useCallback(
    (approval: PendingApproval): PendingApprovalEntry[] =>
      rowsForTimesheet(approval)
        .map((r) => ({
          id: r.id,
          projectId: r.project_id,
          task: r.task ?? "",
          description: r.description,
          minutes: r.duration_minutes ?? 0,
          startTime: r.start_time,
        }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [rowsForTimesheet],
  );

  const timesheetForWeek = useCallback(
    (weekStart: Date) => {
      const key = toDateKey(weekStart);
      return timesheets.find((t) => t.userId === uid && t.weekStart === key);
    },
    [timesheets, uid],
  );

  const submitTimesheet = useCallback(
    async (weekStart: Date) => {
      const { data, error } = await supabase.rpc("submit_timesheet", {
        _week_start: toDateKey(weekStart),
      });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      // M29: best-effort notification to whoever can review this — a
      // failure here (network drop, the edge function not deployed yet,
      // SENDGRID_API_KEY/NOTIFY_FROM_ADDRESS not configured) should never
      // make the submit itself look like it failed. Fire-and-forget, not
      // awaited by the caller of submitTimesheet().
      if (data) {
        supabase.functions
          .invoke("notify-timesheet-submitted", { body: { timesheet_id: data.id } })
          .catch(() => {});
      }
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

  // M47: which (person, week) pairs have already had a reminder sent, so
  // the button can say "Reminded" instead of offering a click that the
  // one-per-week rule will just refuse. RLS scopes this to the caller's own
  // reminders plus, for a manager/admin, their team's — same window as
  // timesheets above, since a reminder for a week nothing else can show is
  // of no use to the UI.
  const remindersQ = useQuery({
    queryKey: ["timesheet_reminders"],
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheet_reminders")
        .select("user_id, week_start, sent_at")
        .gte("week_start", toDateKey(oldestLoadedWeekStart()));
      if (error) throw error;
      return data;
    },
  });

  /** Keyed `${userId}|${weekStart}` — presence means a reminder has already gone out for that week. */
  const remindedWeeks = useMemo(
    () => new Set((remindersQ.data ?? []).map((r) => `${r.user_id}|${r.week_start}`)),
    [remindersQ.data],
  );

  // M47: unlike submitTimesheet's fire-and-forget notification, this is
  // awaited and its failure surfaced — the reminder *is* the action, so
  // "couldn't send" has to reach the manager rather than being swallowed.
  // The RPC that records it lives inside the edge function (it needs the
  // recipient's email, which the browser never sees), so there's one call
  // here, not two.
  const remindToSubmit = useCallback(
    async (userId: string, weekStart: string) => {
      const { data, error } = await supabase.functions.invoke("notify-timesheet-reminder", {
        body: { user_id: userId, week_start: weekStart },
      });
      qc.invalidateQueries({ queryKey: ["timesheet_reminders"] });
      qc.invalidateQueries({ queryKey: ["activity_log"] });
      // A non-2xx from the function arrives as a FunctionsHttpError whose
      // message is just "Edge Function returned a non-2xx status code" —
      // the actual reason ("already been reminded", "already submitted") is
      // in the response body, so it has to be read back out of the context.
      if (error) {
        const detail = await (error as { context?: Response }).context
          ?.json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined);
        throw new Error(detail || error.message);
      }
      // Secrets unset on the project — the function returns 200 with a
      // reason rather than erroring, which would otherwise read as success.
      if (data?.reason === "not configured") {
        throw new Error("Email isn't configured for this workspace yet.");
      }
    },
    [qc],
  );

  return {
    timesheetsQ,
    reviewEntriesQ,
    timesheets,
    pendingApprovals,
    entriesForApproval,
    timesheetForWeek,
    submitTimesheet,
    reviewTimesheet,
    remindedWeeks,
    remindToSubmit,
  };
}
