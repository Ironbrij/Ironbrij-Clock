import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { throwIf } from "./utils";
import type { WorkspacePlacedVA, WorkspacePlacement, WorkspacePlacementInput } from "./types";

type PlacementUpdate = Database["public"]["Tables"]["va_placements"]["Update"];

const DUPLICATE_PLACEMENT_MESSAGE =
  "That VA already has a placement with this client starting on that date.";

export function usePlacementsData(enabled: boolean, canManage: boolean, uid: string | null) {
  const qc = useQueryClient();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["va_placements"] });
    qc.invalidateQueries({ queryKey: ["placed_vas"] });
  }, [qc]);

  // One channel for both tables, same as use-projects.ts does for its four.
  // Gated on canManage because RLS would block a Member from receiving
  // these events anyway.
  useEffect(() => {
    if (!enabled || !canManage) return;
    const channel = supabase
      .channel("va_placements_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "va_placements" }, () =>
        invalidate(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "placed_vas" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, canManage, invalidate]);

  const placedVAsQ = useQuery({
    queryKey: ["placed_vas"],
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("placed_vas")
        .select("id, full_name")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const placementsQ = useQuery({
    queryKey: ["va_placements"],
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("va_placements")
        .select(
          "id, placed_va_id, client_id, started_on, ended_on, va_monthly_rate, client_package_amount",
        )
        .order("started_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const placedVAs = useMemo<WorkspacePlacedVA[]>(
    () => (placedVAsQ.data ?? []).map((v) => ({ id: v.id, fullName: v.full_name })),
    [placedVAsQ.data],
  );

  const placements = useMemo<WorkspacePlacement[]>(
    () =>
      (placementsQ.data ?? []).map((p) => ({
        id: p.id,
        placedVaId: p.placed_va_id,
        clientId: p.client_id,
        startedOn: p.started_on,
        endedOn: p.ended_on,
        vaMonthlyRate: p.va_monthly_rate === null ? null : Number(p.va_monthly_rate),
        clientPackageAmount:
          p.client_package_amount === null ? null : Number(p.client_package_amount),
      })),
    [placementsQ.data],
  );

  /**
   * Resolves the placed VA, creating one if the form supplied a new name.
   * Placed VAs aren't invited or onboarded anywhere — a name typed into the
   * placement form is the only way one ever comes into existence.
   */
  const resolvePlacedVaId = useCallback(
    async (input: WorkspacePlacementInput): Promise<string> => {
      if (input.placedVaId) return input.placedVaId;
      const name = input.placedVaName?.trim();
      if (!name) throw new Error("A VA name is required.");
      const existing = placedVAs.find((v) => v.fullName.toLowerCase() === name.toLowerCase());
      if (existing) return existing.id;
      const { data, error } = await supabase
        .from("placed_vas")
        .insert({ full_name: name })
        .select("id")
        .single();
      throwIf(error);
      if (!data) throw new Error("Couldn't create that VA.");
      return data.id;
    },
    [placedVAs],
  );

  const createPlacement = useCallback(
    async (input: WorkspacePlacementInput) => {
      const placedVaId = await resolvePlacedVaId(input);
      const { error } = await supabase.from("va_placements").insert({
        placed_va_id: placedVaId,
        client_id: input.clientId,
        started_on: input.startedOn,
        ended_on: input.endedOn,
        va_monthly_rate: input.vaMonthlyRate,
        client_package_amount: input.clientPackageAmount,
        updated_by: uid,
      });
      throwIf(error, { "23505": DUPLICATE_PLACEMENT_MESSAGE });
      invalidate();
    },
    [invalidate, resolvePlacedVaId, uid],
  );

  const updatePlacement = useCallback(
    async (
      id: string,
      patch: {
        startedOn?: string;
        endedOn?: string | null;
        vaMonthlyRate?: number | null;
        clientPackageAmount?: number | null;
      },
    ) => {
      const row: PlacementUpdate = {
        updated_at: new Date().toISOString(),
        updated_by: uid,
      };
      if (patch.startedOn !== undefined) row.started_on = patch.startedOn;
      if (patch.endedOn !== undefined) row.ended_on = patch.endedOn;
      if (patch.vaMonthlyRate !== undefined) row.va_monthly_rate = patch.vaMonthlyRate;
      if (patch.clientPackageAmount !== undefined) {
        row.client_package_amount = patch.clientPackageAmount;
      }
      const { error } = await supabase.from("va_placements").update(row).eq("id", id);
      throwIf(error, { "23505": DUPLICATE_PLACEMENT_MESSAGE });
      invalidate();
    },
    [invalidate, uid],
  );

  const deletePlacement = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("va_placements").delete().eq("id", id);
      throwIf(error);
      invalidate();
    },
    [invalidate],
  );

  return { placements, placedVAs, createPlacement, updatePlacement, deletePlacement };
}
