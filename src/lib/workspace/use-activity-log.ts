import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

  return { activityLogQ, activityLog };
}
