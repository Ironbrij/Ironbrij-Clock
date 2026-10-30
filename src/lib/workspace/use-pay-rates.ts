import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { groupPayHistory, payHistoryFromEmployment, type PayRateRow } from "@/lib/pay-rates";
import { fetchAllRows, PAGED_READ_MAX_ROWS, throwIf } from "./utils";
import type { WorkspaceEmployment } from "./types";

export type PayRateInput = {
  userId: string;
  effectiveFrom: string;
  hourlyRate: number | null;
  weeklySalary: number | null;
};

/**
 * 2026-10-30: team pay with start dates (member_pay_rates). Managers and
 * admins only, like member_employment. If the table can't be read (the app
 * deployed a moment before its migration), each person's history is built
 * from the single figures member_employment still holds, by the same rules
 * the migration seeded with, so costs never drop to nothing.
 */
export function usePayRatesData(
  enabled: boolean,
  canManage: boolean,
  uid: string | null,
  employmentByUser: Map<string, WorkspaceEmployment>,
) {
  const qc = useQueryClient();

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["member_pay_rates"] }),
    [qc],
  );

  useEffect(() => {
    if (!enabled || !canManage) return;
    const channel = supabase
      .channel("member_pay_rates_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "member_pay_rates" }, () =>
        invalidate(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, canManage, invalidate]);

  const payRatesQ = useQuery({
    queryKey: ["member_pay_rates"],
    enabled: enabled && canManage,
    queryFn: async (): Promise<PayRateRow[] | null> => {
      try {
        const rows = await fetchAllRows(
          (start, end) =>
            supabase
              .from("member_pay_rates")
              .select("id, user_id, effective_from, hourly_rate, weekly_salary")
              .order("user_id")
              .order("effective_from")
              .order("id")
              .range(start, end),
          PAGED_READ_MAX_ROWS,
        );
        return rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          effectiveFrom: r.effective_from,
          hourlyRate: r.hourly_rate === null ? null : Number(r.hourly_rate),
          weeklySalary: r.weekly_salary === null ? null : Number(r.weekly_salary),
        }));
      } catch (error) {
        console.error("member_pay_rates couldn't be read; using member_employment's pay", error);
        return null;
      }
    },
  });

  const payHistoryByUser = useMemo(() => {
    if (payRatesQ.data) return groupPayHistory(payRatesQ.data);
    return groupPayHistory(
      [...employmentByUser.values()].flatMap((e) => payHistoryFromEmployment(e)),
    );
  }, [payRatesQ.data, employmentByUser]);

  /** Adds a pay change, or replaces the one already on that date for that person. */
  const setPayRate = useCallback(
    async (input: PayRateInput) => {
      const { data, error } = await supabase
        .from("member_pay_rates")
        .upsert(
          {
            user_id: input.userId,
            effective_from: input.effectiveFrom,
            hourly_rate: input.hourlyRate,
            weekly_salary: input.weeklySalary,
            updated_by: uid,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,effective_from" },
        )
        .select("id");
      throwIf(error, { "23514": "A pay change is an hourly rate or a weekly salary, not both." });
      if (!data || data.length === 0) throw new Error("Only managers and admins can change pay.");
      invalidate();
    },
    [invalidate, uid],
  );

  const removePayRate = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("member_pay_rates")
        .delete()
        .eq("id", id)
        .select("id");
      throwIf(error);
      if (!data || data.length === 0) throw new Error("Only managers and admins can change pay.");
      invalidate();
    },
    [invalidate],
  );

  return { payHistoryByUser, setPayRate, removePayRate };
}
