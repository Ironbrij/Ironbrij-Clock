import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import type { Database } from "@/integrations/supabase/types";
import { toPlacementCategory } from "./types";
import { fetchAllRows, PAGED_READ_MAX_ROWS, throwIf } from "./utils";
import type {
  PlacementCategory,
  WorkspacePlacedVA,
  WorkspacePlacement,
  WorkspacePlacementInput,
} from "./types";

type PlacementUpdate = Database["public"]["Tables"]["va_placements"]["Update"];

const DUPLICATE_PLACEMENT_MESSAGE =
  "That VA already has a placement with this client starting on that date.";

/** The key `placementWeekHoursForRange` uses for one placement's week. */
export const placementWeekKey = (placementId: string, weekStart: string) =>
  `${placementId}:${weekStart}`;

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
      // "*" rather than a column list: if this deploys a moment before
      // 20261016030000 adds client_hourly_rate, a named column would fail the
      // whole query and empty Billing → Placements.
      const { data, error } = await supabase
        .from("va_placements")
        .select("*")
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
        vaHourlyRate: p.va_hourly_rate === null ? null : Number(p.va_hourly_rate),
        contractedWeeklyHours:
          p.contracted_weekly_hours === null ? null : Number(p.contracted_weekly_hours),
        // `?? null` covers the column not existing yet (see the select above).
        clientHourlyRate:
          (p.client_hourly_rate ?? null) === null ? null : Number(p.client_hourly_rate),
        category: toPlacementCategory(p.employment_type),
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
        va_hourly_rate: input.vaHourlyRate,
        contracted_weekly_hours: input.contractedWeeklyHours,
        client_hourly_rate: input.clientHourlyRate,
        employment_type: input.category,
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
        vaHourlyRate?: number | null;
        contractedWeeklyHours?: number | null;
        clientHourlyRate?: number | null;
        category?: PlacementCategory;
      },
    ) => {
      const row: PlacementUpdate = {
        updated_at: new Date().toISOString(),
        updated_by: uid,
      };
      if (patch.startedOn !== undefined) row.started_on = patch.startedOn;
      if (patch.endedOn !== undefined) row.ended_on = patch.endedOn;
      if (patch.vaHourlyRate !== undefined) row.va_hourly_rate = patch.vaHourlyRate;
      if (patch.contractedWeeklyHours !== undefined) {
        row.contracted_weekly_hours = patch.contractedWeeklyHours;
      }
      if (patch.clientHourlyRate !== undefined) row.client_hourly_rate = patch.clientHourlyRate;
      if (patch.category !== undefined) row.employment_type = patch.category;
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

  /**
   * 2026-10-16: the hours accounts entered per placement for every week a
   * range touches, keyed by `placementWeekKey`. A week with no entry is
   * simply absent — callers fall back to the contracted hours
   * (placementWeekFigures in src/lib/retainer.ts). Fetched on demand, like
   * detailedEntriesForRange, rather than kept in workspace state: it grows
   * by one row per placement per week.
   */
  const placementWeekHoursForRange = useCallback(
    async (from: string, to: string): Promise<Map<string, number>> => {
      // The Monday of the week `from` falls in, so a range starting mid-week
      // still gets that week's entry.
      const firstMonday = toDateKey(startOfWeek(fromDateKey(from)));
      const rows = await fetchAllRows(
        (start, end) =>
          supabase
            .from("placement_week_hours")
            .select("id, placement_id, week_start, hours")
            .gte("week_start", firstMonday)
            .lte("week_start", to)
            .order("week_start")
            .order("id")
            .range(start, end),
        PAGED_READ_MAX_ROWS,
      );
      return new Map(
        rows.map((r) => [placementWeekKey(r.placement_id, r.week_start), Number(r.hours)]),
      );
    },
    [],
  );

  /**
   * Records a placement's actual hours for one week, or clears the entry
   * (`hours` null) so the week goes back to the contracted hours. Upsert on
   * the (placement, week) pair, then the same zero-row check the time-entry
   * hooks use: RLS turns a blocked write into "nothing happened", not an
   * error.
   */
  const setPlacementWeekHours = useCallback(
    async (placementId: string, weekStart: string, hours: number | null) => {
      if (hours === null) {
        const { error } = await supabase
          .from("placement_week_hours")
          .delete()
          .eq("placement_id", placementId)
          .eq("week_start", weekStart);
        throwIf(error);
        return;
      }
      const { data, error } = await supabase
        .from("placement_week_hours")
        .upsert(
          {
            placement_id: placementId,
            week_start: weekStart,
            hours,
            updated_by: uid,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "placement_id,week_start" },
        )
        .select("id");
      throwIf(error, { "23514": "Hours must be between 0 and 168." });
      if (!data || data.length === 0) {
        throw new Error("Only managers and admins can enter a placement's hours.");
      }
    },
    [uid],
  );

  return {
    placements,
    placedVAs,
    createPlacement,
    updatePlacement,
    deletePlacement,
    placementWeekHoursForRange,
    setPlacementWeekHours,
  };
}
