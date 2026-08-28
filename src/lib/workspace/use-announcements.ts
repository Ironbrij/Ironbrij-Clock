import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceAnnouncement } from "./types";

const LAST_SEEN_KEY = "ironbrij-announcements-last-seen";

export function useAnnouncementsData(enabled: boolean) {
  const qc = useQueryClient();

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ["announcements"] }), [qc]);

  // Same "another tab/device changed this" coverage every other workspace
  // table gets (L27) — a posted or deleted announcement shows up live.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("announcements_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () =>
        invalidate(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "announcement_teams" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, invalidate]);

  // One query fetches both tables and joins them client-side — same
  // pattern reports.tsx's detailedRows uses to join entries against
  // projects/members without a DB view. RLS on each table already scopes
  // what comes back (announcements_select / announcement_teams_select),
  // so there's nothing further to filter here.
  const announcementsQ = useQuery({
    queryKey: ["announcements"],
    enabled,
    queryFn: async () => {
      const [{ data: rows, error: rowsError }, { data: teamRows, error: teamRowsError }] =
        await Promise.all([
          supabase
            .from("announcements")
            .select("id, author_id, title, body, audience, created_at")
            .order("created_at", { ascending: false }),
          supabase.from("announcement_teams").select("announcement_id, team_id"),
        ]);
      if (rowsError) throw rowsError;
      if (teamRowsError) throw teamRowsError;
      return { rows: rows ?? [], teamRows: teamRows ?? [] };
    },
  });

  const announcements = useMemo<WorkspaceAnnouncement[]>(() => {
    const rows = announcementsQ.data?.rows ?? [];
    const teamRows = announcementsQ.data?.teamRows ?? [];
    return rows.map((a) => ({
      id: a.id,
      authorId: a.author_id,
      title: a.title,
      body: a.body,
      audience: a.audience as "everyone" | "teams",
      teamIds: teamRows.filter((t) => t.announcement_id === a.id).map((t) => t.team_id),
      createdAt: a.created_at,
    }));
  }, [announcementsQ.data]);

  // Same "unseen since last visit" shape as use-activity-log.ts — a plain
  // localStorage timestamp, not per-announcement read state. A nudge to
  // check the page, not a per-recipient read-receipts feature.
  const [lastSeen, setLastSeen] = useState<string>(() => {
    if (typeof window === "undefined") return new Date(0).toISOString();
    return window.localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
  });

  const unseenAnnouncementCount = useMemo(
    () => announcements.filter((a) => a.createdAt > lastSeen).length,
    [announcements, lastSeen],
  );

  const markAnnouncementsSeen = useCallback(() => {
    const now = new Date().toISOString();
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_SEEN_KEY, now);
    setLastSeen(now);
  }, []);

  const createAnnouncement = useCallback(
    async (input: {
      title: string;
      body: string;
      audience: "everyone" | "teams";
      teamIds: string[];
    }) => {
      const { data, error } = await supabase.rpc("create_announcement", {
        _title: input.title.trim(),
        _body: input.body.trim(),
        _audience: input.audience,
        // The RPC only reads _team_ids when _audience is 'teams' — an empty
        // array for 'everyone' is inert, and matches the generated RPC arg
        // type (string[], not string[] | null).
        _team_ids: input.audience === "teams" ? input.teamIds : [],
      });
      throwIf(error);
      invalidate();
      // Best-effort — a failed/unconfigured/undeployed notification should
      // never make the post itself look like it failed, same reasoning as
      // submitTimesheet()'s notify-timesheet-submitted call.
      if (data) {
        supabase.functions
          .invoke("notify-announcement-posted", { body: { announcement_id: data } })
          .catch(() => {});
      }
    },
    [invalidate],
  );

  const deleteAnnouncement = useCallback(
    async (id: string) => {
      // RLS silently excludes a row it blocks rather than erroring (see
      // CLAUDE.md) — checking the returned row count catches that instead
      // of reporting success for a delete that didn't actually happen.
      const { data, error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) {
        throw new Error("Couldn't delete that announcement — it may already be gone.");
      }
      invalidate();
    },
    [invalidate],
  );

  return {
    announcementsQ,
    announcements,
    unseenAnnouncementCount,
    markAnnouncementsSeen,
    createAnnouncement,
    deleteAnnouncement,
  };
}
