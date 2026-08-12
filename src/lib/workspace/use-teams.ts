import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { Team } from "./types";

export function useTeamsData(enabled: boolean) {
  const qc = useQueryClient();

  // L27: team_members' own subscription lives in use-members.ts (it owns
  // the "who's on what team" data members care about) — subscribing to it
  // again here too would just be a second websocket listener invalidating
  // the same query key.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("teams_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () =>
        qc.invalidateQueries({ queryKey: ["teams"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  const teamsQ = useQuery({
    queryKey: ["teams"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, color")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const teams = useMemo<Team[]>(() => teamsQ.data ?? [], [teamsQ.data]);

  const createTeam = useCallback(
    async ({ name, color, memberIds }: { name: string; color: string; memberIds: string[] }) => {
      const { data, error } = await supabase
        .from("teams")
        .insert({ name, color })
        .select("id")
        .single();
      throwIf(error, { "23505": "A team with that name already exists." });
      if (data && memberIds.length) {
        await supabase
          .from("team_members")
          .insert(memberIds.map((user_id) => ({ user_id, team_id: data.id })));
      }
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team_members"] });
    },
    [qc],
  );

  const updateTeam = useCallback(
    async (teamId: string, input: { name: string; color: string }) => {
      const { error } = await supabase.from("teams").update(input).eq("id", teamId);
      throwIf(error, { "23505": "A team with that name already exists." });
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    [qc],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", teamId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team_members"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [qc],
  );

  return { teamsQ, teams, createTeam, updateTeam, deleteTeam };
}
