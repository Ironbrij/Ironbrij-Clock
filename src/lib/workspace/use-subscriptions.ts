import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows, PAGED_READ_MAX_ROWS, throwIf } from "./utils";
import type {
  SubscriptionCategory,
  SubscriptionCycle,
  SubscriptionStatus,
  WorkspaceSubscription,
  WorkspaceSubscriptionInput,
} from "./types";

/**
 * 2026-10-16: software subscriptions for the Subscriptions page. Managers and
 * admins only — subscriptions' RLS is can_manage(), so the request isn't
 * even sent for anyone else.
 */
export function useSubscriptionsData(enabled: boolean, canManage: boolean, uid: string | null) {
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ["subscriptions"] }), [qc]);

  useEffect(() => {
    if (!enabled || !canManage) return;
    const channel = supabase
      .channel("subscriptions_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, canManage, invalidate]);

  const subscriptionsQ = useQuery({
    queryKey: ["subscriptions"],
    enabled: enabled && canManage,
    queryFn: () =>
      fetchAllRows(
        (start, end) =>
          supabase
            .from("subscriptions")
            // "*" rather than a column list, so a column added by a migration
            // that hasn't run yet can't fail the whole read (see use-placements).
            .select("*")
            .order("name")
            .order("id")
            .range(start, end),
        PAGED_READ_MAX_ROWS,
      ),
  });

  const subscriptions = useMemo<WorkspaceSubscription[]>(
    () =>
      (subscriptionsQ.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category as SubscriptionCategory,
        teamId: s.team_id,
        // `?? false` covers the column not existing yet.
        allDepartments: s.all_departments ?? false,
        departmentNote: s.department_note,
        amount: s.amount === null ? null : Number(s.amount),
        currency: s.currency,
        billingCycle: s.billing_cycle as SubscriptionCycle,
        renewsOn: s.renews_on,
        status: s.status as SubscriptionStatus,
        notes: s.notes,
      })),
    [subscriptionsQ.data],
  );

  // Mirrors the table's CHECKs so the form gets a plain message.
  const toRow = (input: WorkspaceSubscriptionInput) => {
    const name = input.name.trim();
    if (!name) throw new Error("Give the subscription a name.");
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Error("Currency must be a 3-letter code, like USD.");
    if (input.amount !== null && !(input.amount >= 0)) throw new Error("Cost can't be negative.");
    return {
      name,
      category: input.category,
      team_id: input.allDepartments ? null : input.teamId,
      all_departments: input.allDepartments,
      department_note: input.departmentNote?.trim() || null,
      amount: input.amount,
      currency,
      billing_cycle: input.billingCycle,
      renews_on: input.renewsOn || null,
      status: input.status,
      notes: input.notes?.trim() || null,
    };
  };

  const createSubscription = useCallback(
    async (input: WorkspaceSubscriptionInput) => {
      const { error } = await supabase
        .from("subscriptions")
        .insert({ ...toRow(input), created_by: uid, updated_by: uid });
      throwIf(error);
      invalidate();
    },
    [invalidate, uid],
  );

  const updateSubscription = useCallback(
    async (id: string, input: WorkspaceSubscriptionInput) => {
      // .select("id") + length check: a write RLS blocks reports success
      // while changing nothing (see CLAUDE.md, "Authorization model").
      const { data, error } = await supabase
        .from("subscriptions")
        .update({ ...toRow(input), updated_by: uid, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) {
        throw new Error("That subscription no longer exists, or you can't edit it.");
      }
      invalidate();
    },
    [invalidate, uid],
  );

  const deleteSubscription = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("subscriptions")
        .delete()
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) {
        throw new Error("That subscription no longer exists, or you can't remove it.");
      }
      invalidate();
    },
    [invalidate],
  );

  return { subscriptions, createSubscription, updateSubscription, deleteSubscription };
}
