import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows, PAGED_READ_MAX_ROWS, throwIf } from "./utils";
import type { RevenueKind, WorkspaceRevenueItem, WorkspaceRevenueItemInput } from "./types";

/**
 * 2026-10-16: one-off fees (recruitment & set-up for now) for Billing → Fees
 * & revenue and Reports → Gross Profit. Managers and admins only, the same as
 * billing rates: revenue_items' RLS is can_manage(), so a Member's request
 * would come back empty anyway and isn't sent.
 */
export function useRevenueItemsData(enabled: boolean, canManage: boolean, uid: string | null) {
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ["revenue_items"] }), [qc]);

  useEffect(() => {
    if (!enabled || !canManage) return;
    const channel = supabase
      .channel("revenue_items_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "revenue_items" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, canManage, invalidate]);

  const revenueItemsQ = useQuery({
    queryKey: ["revenue_items"],
    enabled: enabled && canManage,
    // A handful of fees a month, so the whole table is small enough to keep
    // loaded — paged anyway, past the server's 1,000-row cap.
    queryFn: () =>
      fetchAllRows(
        (start, end) =>
          supabase
            .from("revenue_items")
            .select("id, received_on, client_id, kind, amount, note")
            .order("received_on", { ascending: false })
            .order("id")
            .range(start, end),
        PAGED_READ_MAX_ROWS,
      ),
  });

  const revenueItems = useMemo<WorkspaceRevenueItem[]>(
    () =>
      (revenueItemsQ.data ?? []).map((r) => ({
        id: r.id,
        receivedOn: r.received_on,
        clientId: r.client_id,
        kind: r.kind as RevenueKind,
        amount: Number(r.amount),
        note: r.note,
      })),
    [revenueItemsQ.data],
  );

  // Client-side checks mirror revenue_items' CHECK constraints, so the form
  // gets a plain message rather than a constraint name.
  const validate = (input: WorkspaceRevenueItemInput) => {
    if (!input.receivedOn) throw new Error("Pick the date the fee counts towards.");
    if (!(input.amount > 0)) throw new Error("The amount must be more than zero.");
  };

  const createRevenueItem = useCallback(
    async (input: WorkspaceRevenueItemInput) => {
      validate(input);
      const { error } = await supabase.from("revenue_items").insert({
        received_on: input.receivedOn,
        client_id: input.clientId,
        kind: input.kind,
        amount: input.amount,
        note: input.note?.trim() || null,
        created_by: uid,
        updated_by: uid,
      });
      throwIf(error);
      invalidate();
    },
    [invalidate, uid],
  );

  const updateRevenueItem = useCallback(
    async (id: string, input: WorkspaceRevenueItemInput) => {
      validate(input);
      // .select("id") + length check: a write RLS blocks reports success
      // while changing nothing (see CLAUDE.md, "Authorization model").
      const { data, error } = await supabase
        .from("revenue_items")
        .update({
          received_on: input.receivedOn,
          client_id: input.clientId,
          kind: input.kind,
          amount: input.amount,
          note: input.note?.trim() || null,
          updated_by: uid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0)
        throw new Error("That fee no longer exists, or you can't edit it.");
      invalidate();
    },
    [invalidate, uid],
  );

  const deleteRevenueItem = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("revenue_items")
        .delete()
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0)
        throw new Error("That fee no longer exists, or you can't remove it.");
      invalidate();
    },
    [invalidate],
  );

  return { revenueItems, createRevenueItem, updateRevenueItem, deleteRevenueItem };
}
