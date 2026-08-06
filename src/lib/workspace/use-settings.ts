import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import type { WorkspaceSettings } from "./types";

export function useSettingsData(enabled: boolean) {
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["workspace_settings"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_settings")
        .select(
          "company_name, logo_url, timezone, weekly_hours, currency, require_descriptions, allow_manual_entry",
        )
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const settings = useMemo<WorkspaceSettings>(() => {
    const s = settingsQ.data;
    return {
      companyName: s?.company_name ?? "Ironbrij",
      logoDataUrl: s?.logo_url ?? null,
      timezone: s?.timezone ?? "Australia/Sydney",
      weeklyHours: Number(s?.weekly_hours ?? 37.5),
      currency: s?.currency ?? "AUD",
      requireDescriptions: s?.require_descriptions ?? false,
      allowManualEntry: s?.allow_manual_entry ?? true,
    };
  }, [settingsQ.data]);

  const updateSettings = useCallback(
    async (patch: Partial<WorkspaceSettings>) => {
      const row: Record<string, unknown> = { id: true };
      if (patch.companyName !== undefined) row["company_name"] = patch.companyName;
      if (patch.logoDataUrl !== undefined) row["logo_url"] = patch.logoDataUrl;
      if (patch.timezone !== undefined) row["timezone"] = patch.timezone;
      if (patch.weeklyHours !== undefined) row["weekly_hours"] = patch.weeklyHours;
      if (patch.currency !== undefined) row["currency"] = patch.currency;
      if (patch.requireDescriptions !== undefined)
        row["require_descriptions"] = patch.requireDescriptions;
      if (patch.allowManualEntry !== undefined) row["allow_manual_entry"] = patch.allowManualEntry;
      const { error } = await supabase.from("workspace_settings").upsert(row as never);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["workspace_settings"] });
    },
    [qc],
  );

  return { settingsQ, settings, updateSettings };
}
