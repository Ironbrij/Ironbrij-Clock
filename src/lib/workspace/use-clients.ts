import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceClient, WorkspaceClientProfile } from "./types";

/** Maps the camelCase profile the forms deal in onto the clients table's own columns. */
const profileColumns = (profile: WorkspaceClientProfile) => ({
  basecamp_url: profile.basecampUrl,
  contact_name: profile.contactName,
  contact_email: profile.contactEmail,
  subscription_hours: profile.subscriptionHours,
});

export function useClientsData(enabled: boolean) {
  const qc = useQueryClient();

  // L27: a name change, active/inactive toggle, or profile edit made in
  // another tab used to sit stale until something else triggered a
  // refetch.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("clients_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, () =>
        qc.invalidateQueries({ queryKey: ["clients"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  const clientsQ = useQuery({
    queryKey: ["clients"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "id, name, is_active, basecamp_url, contact_name, contact_email, subscription_hours",
        )
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // 2026-10-30: the finished weeks of each client's Casual VA – External
  // placements, which come off the client's remaining hours. If the function
  // isn't there yet (the app deployed a moment before its migration), fall
  // back to none: remaining hours then behave as they did before it existed.
  const placementHoursQ = useQuery({
    queryKey: ["client_placement_hours"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_placement_hours");
      if (error) {
        console.error("client_placement_hours failed; counting no placement hours", error);
        return [];
      }
      return data;
    },
  });

  const clientPlacementHours = useMemo(
    () => new Map((placementHoursQ.data ?? []).map((r) => [r.client_id, Number(r.hours)])),
    [placementHoursQ.data],
  );

  const clients = useMemo<WorkspaceClient[]>(
    () =>
      (clientsQ.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        active: c.is_active,
        basecampUrl: c.basecamp_url,
        contactName: c.contact_name,
        contactEmail: c.contact_email,
        subscriptionHours: c.subscription_hours,
      })),
    [clientsQ.data],
  );

  // Internal only — not part of the public workspace context. Used by
  // createProject/updateProject in workspace-store.tsx to turn a client
  // *name* (what the project form deals in) into an id.
  const resolveClientId = useCallback(
    (name: string) => (clientsQ.data ?? []).find((c) => c.name === name)?.id ?? null,
    [clientsQ.data],
  );

  // The profile is optional so a client can still be created from just a
  // name (that's all the seed/import paths have), but the Clients tab now
  // collects it up front rather than leaving every new client to be opened
  // and edited a second time.
  const createClient = useCallback(
    async (name: string, profile?: WorkspaceClientProfile) => {
      const { error } = await supabase
        .from("clients")
        .insert({ name: name.trim(), ...(profile ? profileColumns(profile) : {}) });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    [qc],
  );

  const updateClient = useCallback(
    async (id: string, name: string) => {
      const { error } = await supabase.from("clients").update({ name: name.trim() }).eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    [qc],
  );

  const setClientActive = useCallback(
    async (id: string, active: boolean) => {
      const { error } = await supabase.from("clients").update({ is_active: active }).eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    [qc],
  );

  const updateClientProfile = useCallback(
    async (id: string, profile: WorkspaceClientProfile) => {
      const { error } = await supabase.from("clients").update(profileColumns(profile)).eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    [qc],
  );

  /**
   * Projects → Clients → Import remaining hours: sets one client's
   * subscription hours and nothing else. Chains .select("id") because RLS
   * turns a blocked update into "no rows changed" rather than an error.
   */
  const setClientSubscriptionHours = useCallback(
    async (id: string, hours: number) => {
      const { data, error } = await supabase
        .from("clients")
        .update({ subscription_hours: hours })
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) throw new Error("Couldn't update that client's hours.");
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    [qc],
  );

  const deleteClient = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [qc],
  );

  return {
    clientsQ,
    clients,
    resolveClientId,
    createClient,
    updateClient,
    setClientActive,
    updateClientProfile,
    deleteClient,
    setClientSubscriptionHours,
    clientPlacementHours,
  };
}
