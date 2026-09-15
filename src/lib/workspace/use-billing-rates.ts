import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceBillingRate, WorkspaceBillingRateInput } from "./types";

const DUPLICATE_RATE_MESSAGE =
  "A rate for that client already starts on that date — edit or remove the existing one instead.";

export function useBillingRatesData(enabled: boolean, canManage: boolean, uid: string | null) {
  const qc = useQueryClient();

  // Gated on canManage the same way use-employment.ts is — billing_rates'
  // RLS would block a Member from receiving these events anyway, so
  // there's no reason to even open the channel.
  useEffect(() => {
    if (!enabled || !canManage) return;
    const channel = supabase
      .channel("billing_rates_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_rates" }, () =>
        qc.invalidateQueries({ queryKey: ["billing_rates"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, canManage, qc]);

  const billingRatesQ = useQuery({
    queryKey: ["billing_rates"],
    // RLS already restricts this to admins/managers, but there's no reason
    // to fire the request at all for anyone else.
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_rates")
        .select("id, client_id, user_id, hourly_rate, effective_from")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const billingRates = useMemo<WorkspaceBillingRate[]>(
    () =>
      (billingRatesQ.data ?? []).map((r) => ({
        id: r.id,
        clientId: r.client_id,
        userId: r.user_id,
        hourlyRate: Number(r.hourly_rate),
        effectiveFrom: r.effective_from,
      })),
    [billingRatesQ.data],
  );

  const createBillingRate = useCallback(
    async (input: WorkspaceBillingRateInput) => {
      const { error } = await supabase.from("billing_rates").insert({
        client_id: input.clientId,
        user_id: input.userId,
        hourly_rate: input.hourlyRate,
        effective_from: input.effectiveFrom,
        updated_by: uid,
      });
      throwIf(error, { "23505": DUPLICATE_RATE_MESSAGE });
      qc.invalidateQueries({ queryKey: ["billing_rates"] });
    },
    [qc, uid],
  );

  const updateBillingRate = useCallback(
    async (id: string, hourlyRate: number) => {
      const { error } = await supabase
        .from("billing_rates")
        .update({ hourly_rate: hourlyRate, updated_at: new Date().toISOString(), updated_by: uid })
        .eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["billing_rates"] });
    },
    [qc, uid],
  );

  const deleteBillingRate = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("billing_rates").delete().eq("id", id);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["billing_rates"] });
    },
    [qc],
  );

  return { billingRatesQ, billingRates, createBillingRate, updateBillingRate, deleteBillingRate };
}
