import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { EmploymentType, WorkspaceEmployment } from "./types";

export function useEmploymentData(enabled: boolean, canManage: boolean, uid: string | null) {
  const qc = useQueryClient();

  const employmentQ = useQuery({
    queryKey: ["member_employment"],
    // RLS already restricts this to admins/managers, but there's no
    // reason to fire the request at all for anyone else.
    enabled: enabled && canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_employment")
        .select("user_id, employment_type, hourly_rate, weekly_schedule");
      if (error) throw error;
      return data;
    },
  });

  const employmentByUser = useMemo(() => {
    const map = new Map<string, WorkspaceEmployment>();
    for (const row of employmentQ.data ?? []) {
      map.set(row.user_id, {
        userId: row.user_id,
        employmentType: row.employment_type as EmploymentType,
        hourlyRate: row.hourly_rate,
        weeklySchedule: row.weekly_schedule,
      });
    }
    return map;
  }, [employmentQ.data]);

  const updateMemberEmployment = useCallback(
    async (
      userId: string,
      patch: {
        employmentType?: EmploymentType;
        hourlyRate?: number | null;
        weeklySchedule?: string | null;
      },
    ) => {
      const existing = employmentByUser.get(userId);
      const { error } = await supabase.from("member_employment").upsert({
        user_id: userId,
        employment_type: patch.employmentType ?? existing?.employmentType ?? "full_time",
        hourly_rate:
          patch.hourlyRate !== undefined ? patch.hourlyRate : (existing?.hourlyRate ?? null),
        weekly_schedule:
          patch.weeklySchedule !== undefined
            ? patch.weeklySchedule
            : (existing?.weeklySchedule ?? null),
        updated_at: new Date().toISOString(),
        updated_by: uid,
      });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["member_employment"] });
    },
    [qc, employmentByUser, uid],
  );

  return { employmentQ, employmentByUser, updateMemberEmployment };
}
