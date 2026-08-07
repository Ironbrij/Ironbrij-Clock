import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const LAST_SEEN_KEY = "ironbrij-activity-last-seen";

export type WorkspaceActivityEvent = {
  id: string;
  actorId: string | null;
  action: string;
  targetUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export function useActivityLogData(enabled: boolean, canManage: boolean) {
  const activityLogQ = useQuery({
    queryKey: ["activity_log"],
    // Gated to managers/admins client-side purely to skip a pointless
    // fetch — RLS already returns nothing for anyone else regardless.
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, actor_id, action, target_user_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const activityLog = useMemo<WorkspaceActivityEvent[]>(
    () =>
      (activityLogQ.data ?? []).map((e) => ({
        id: e.id,
        actorId: e.actor_id,
        action: e.action,
        targetUserId: e.target_user_id,
        metadata: (e.metadata ?? {}) as Record<string, unknown>,
        createdAt: e.created_at,
      })),
    [activityLogQ.data],
  );

  // "Unseen since last visit" — a plain localStorage timestamp, not
  // per-event read/unread state. Simple on purpose: this is a nudge to
  // check the tab, not an inbox.
  const [lastSeen, setLastSeen] = useState<string>(() => {
    if (typeof window === "undefined") return new Date(0).toISOString();
    return window.localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
  });

  const unseenActivityCount = useMemo(
    () => activityLog.filter((e) => e.createdAt > lastSeen).length,
    [activityLog, lastSeen],
  );

  const markActivitySeen = useCallback(() => {
    const now = new Date().toISOString();
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_SEEN_KEY, now);
    setLastSeen(now);
  }, []);

  return { activityLogQ, activityLog, unseenActivityCount, markActivitySeen };
}
