import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceClient } from "./types";

export function useClientsData(enabled: boolean) {
  const qc = useQueryClient();

  const clientsQ = useQuery({
    queryKey: ["clients"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, is_active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useMemo<WorkspaceClient[]>(
    () => (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.name, active: c.is_active })),
    [clientsQ.data],
  );

  // Internal only — not part of the public workspace context. Used by
  // createProject/updateProject in workspace-store.tsx to turn a client
  // *name* (what the project form deals in) into an id.
  const resolveClientId = useCallback(
    (name: string) => (clientsQ.data ?? []).find((c) => c.name === name)?.id ?? null,
    [clientsQ.data],
  );

  const createClient = useCallback(
    async (name: string) => {
      const { error } = await supabase.from("clients").insert({ name: name.trim() });
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
    deleteClient,
  };
}
