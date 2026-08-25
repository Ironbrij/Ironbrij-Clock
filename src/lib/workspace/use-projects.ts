import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import { NO_CLIENT, type ProjectInput, type WorkspaceProject } from "./types";

export function useProjectsData(
  enabled: boolean,
  clientsData: { id: string; name: string }[] | undefined,
  resolveClientId: (name: string) => string | null,
) {
  const qc = useQueryClient();

  // L27: a rename/archive/tag/member change made on another tab or device
  // used to sit invisible until something else (a window refocus, a
  // navigation) triggered a refetch — time_entries and timesheets already
  // had this, projects never did.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("projects_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () =>
        qc.invalidateQueries({ queryKey: ["projects"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "project_members" }, () =>
        qc.invalidateQueries({ queryKey: ["project_members"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "project_tags" }, () =>
        qc.invalidateQueries({ queryKey: ["project_tags"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  const projectsQ = useQuery({
    queryKey: ["projects"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id, team_id, color, is_billable, is_archived, budget_hours")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const projectMembersQ = useQuery({
    queryKey: ["project_members"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_members").select("project_id, user_id");
      if (error) throw error;
      return data;
    },
  });

  const projectTagsQ = useQuery({
    queryKey: ["project_tags"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_tags").select("project_id, tag_id");
      if (error) throw error;
      return data;
    },
  });

  const projectHoursQ = useQuery({
    queryKey: ["project_hours"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("project_hours");
      if (error) throw error;
      return data;
    },
  });

  const projects = useMemo<WorkspaceProject[]>(() => {
    const clients = clientsData ?? [];
    const pm = projectMembersQ.data ?? [];
    const pt = projectTagsQ.data ?? [];
    const hours = projectHoursQ.data ?? [];
    return (projectsQ.data ?? []).map((p) => {
      const h = hours.find((x) => x.project_id === p.id);
      return {
        id: p.id,
        name: p.name,
        clientId: p.client_id,
        client: clients.find((c) => c.id === p.client_id)?.name ?? NO_CLIENT,
        teamId: p.team_id ?? "",
        color: p.color,
        hours: (h?.total_minutes ?? 0) / 60,
        weekHours: (h?.week_minutes ?? 0) / 60,
        memberIds: pm.filter((x) => x.project_id === p.id).map((x) => x.user_id),
        tagIds: pt.filter((x) => x.project_id === p.id).map((x) => x.tag_id),
        billable: p.is_billable,
        archived: p.is_archived,
        budgetHours: p.budget_hours,
      };
    });
  }, [projectsQ.data, clientsData, projectMembersQ.data, projectTagsQ.data, projectHoursQ.data]);

  const writeProjectLinks = useCallback(
    async (projectId: string, tagIds: string[], memberIds: string[]) => {
      await supabase.from("project_tags").delete().eq("project_id", projectId);
      await supabase.from("project_members").delete().eq("project_id", projectId);
      if (tagIds.length)
        await supabase
          .from("project_tags")
          .insert(tagIds.map((tag_id) => ({ project_id: projectId, tag_id })));
      if (memberIds.length)
        await supabase
          .from("project_members")
          .insert(memberIds.map((user_id) => ({ project_id: projectId, user_id })));
    },
    [],
  );

  const createProject = useCallback(
    async (input: ProjectInput) => {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: input.name,
          client_id: resolveClientId(input.client),
          team_id: input.teamId || null,
          color: input.color,
          is_billable: input.billable,
          budget_hours: input.budgetHours,
        })
        .select("id")
        .single();
      throwIf(error);
      if (data) await writeProjectLinks(data.id, input.tagIds, input.memberIds);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project_members"] });
      qc.invalidateQueries({ queryKey: ["project_tags"] });
      qc.invalidateQueries({ queryKey: ["project_hours"] });
    },
    [qc, resolveClientId, writeProjectLinks],
  );

  const updateProject = useCallback(
    async (projectId: string, input: ProjectInput) => {
      const { error } = await supabase
        .from("projects")
        .update({
          name: input.name,
          client_id: resolveClientId(input.client),
          team_id: input.teamId || null,
          color: input.color,
          is_billable: input.billable,
          budget_hours: input.budgetHours,
        })
        .eq("id", projectId);
      throwIf(error);
      await writeProjectLinks(projectId, input.tagIds, input.memberIds);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project_members"] });
      qc.invalidateQueries({ queryKey: ["project_tags"] });
    },
    [qc, resolveClientId, writeProjectLinks],
  );

  const archiveProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase
        .from("projects")
        .update({ is_archived: true })
        .eq("id", projectId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [qc],
  );

  const unarchiveProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase
        .from("projects")
        .update({ is_archived: false })
        .eq("id", projectId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [qc],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", projectId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project_members"] });
      qc.invalidateQueries({ queryKey: ["project_tags"] });
      qc.invalidateQueries({ queryKey: ["time_entries"] });
      qc.invalidateQueries({ queryKey: ["project_hours"] });
    },
    [qc],
  );

  const projectHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("project_hours_range", { _from: from, _to: to });
    throwIf(error);
    return (data ?? []).map((r) => ({ projectId: r.project_id, minutes: r.minutes }));
  }, []);

  // M28: billable-only hours per project, for Reports' billable/
  // non-billable split — has to be summed from time_entries.is_billable
  // per row (M26 lets any entry override its project's default), not
  // read off projects.is_billable directly.
  const projectBillableHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("project_billable_hours_range", {
      _from: from,
      _to: to,
    });
    throwIf(error);
    return (data ?? []).map((r) => ({ projectId: r.project_id, minutes: r.billable_minutes }));
  }, []);

  return {
    projectsQ,
    projectMembersQ,
    projectTagsQ,
    projectHoursQ,
    projects,
    writeProjectLinks,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    deleteProject,
    projectHoursForRange,
    projectBillableHoursForRange,
  };
}
