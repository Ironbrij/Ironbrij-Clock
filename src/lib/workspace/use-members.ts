import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { throwIf } from "./utils";
import {
  initialsFrom,
  nameFromEmail,
  toDbRole,
  toRole,
  type DbRole,
  type Role,
  type WorkspaceMember,
} from "./types";

const emptyUser: WorkspaceMember = {
  id: "",
  name: "",
  initials: "—",
  role: "Member",
  title: "",
  teamId: "",
  teamIds: [],
  active: true,
  timezone: "Australia/Sydney",
};

export function useMembersData(enabled: boolean, uid: string | null, session: Session | null) {
  const qc = useQueryClient();

  const profilesQ = useQuery({
    queryKey: ["profiles"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, avatar_url, job_title, timezone, role, is_pending, is_active",
        )
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const teamMembersQ = useQuery({
    queryKey: ["team_members"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("team_members").select("user_id, team_id");
      if (error) throw error;
      return data;
    },
  });

  // Make sure a signed-in person always has a profile row.
  useEffect(() => {
    if (!uid || !session?.user || profilesQ.isLoading || !profilesQ.data) return;
    if (profilesQ.data.some((p) => p.id === uid)) return;
    const email = session.user.email ?? "";
    const meta = session.user.user_metadata ?? {};
    supabase
      .from("profiles")
      .insert({
        id: uid,
        email,
        full_name:
          (meta["full_name"] as string) || (meta["name"] as string) || nameFromEmail(email),
        avatar_url: (meta["avatar_url"] as string) ?? null,
        job_title: "Team member",
        is_pending: true,
      })
      .then(() => qc.invalidateQueries({ queryKey: ["profiles"] }));
  }, [uid, session, profilesQ.data, profilesQ.isLoading, qc]);

  const members = useMemo<WorkspaceMember[]>(() => {
    const links = teamMembersQ.data ?? [];
    return (profilesQ.data ?? []).map((p) => {
      const teamIds = links.filter((l) => l.user_id === p.id).map((l) => l.team_id);
      const name = p.full_name || p.email || "Unnamed";
      return {
        id: p.id,
        name,
        initials: initialsFrom(name),
        role: toRole(p.role as DbRole),
        title: p.job_title ?? "",
        teamId: teamIds[0] ?? "",
        teamIds,
        email: p.email ?? undefined,
        pending: p.is_pending ?? false,
        active: p.is_active ?? true,
        timezone: p.timezone ?? "Australia/Sydney",
      };
    });
  }, [profilesQ.data, teamMembersQ.data]);

  // For rosters and "assign this person" pickers — memberById/reports
  // still use the full `members` list on purpose, so a removed person's
  // name stays correct on anything historical they're already attached to.
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);

  const currentUser = useMemo<WorkspaceMember>(() => {
    const me = members.find((m) => m.id === uid);
    if (me) return me;
    const email = session?.user.email ?? "";
    return email
      ? {
          ...emptyUser,
          id: uid ?? "",
          name: nameFromEmail(email),
          initials: initialsFrom(email),
          email,
        }
      : emptyUser;
  }, [members, uid, session]);

  const isAdmin = currentUser.role === "Admin";
  const canManage = currentUser.role === "Admin" || currentUser.role === "Manager";

  const membersByTeam = useCallback(
    (teamId: string) => members.filter((m) => m.teamIds.includes(teamId)),
    [members],
  );

  const teamMemberCount = useCallback(
    (teamId: string) => membersByTeam(teamId).length,
    [membersByTeam],
  );

  const memberById = useCallback((id: string) => members.find((m) => m.id === id), [members]);

  const invitePeople = useCallback(
    async ({ emails, teamId, role }: { emails: string[]; teamId: string; role: Role }) => {
      const { inviteMembers } = await import("@/lib/admin.functions");
      const result = await inviteMembers({
        data: {
          emails,
          teamId,
          role: toDbRole(role),
          redirectTo: typeof window === "undefined" ? undefined : window.location.origin,
        },
      });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["team_members"] });
      return result.invited;
    },
    [qc],
  );

  const resendInvite = useCallback(async (email: string) => {
    const { resendInvite: resendInviteFn } = await import("@/lib/admin.functions");
    await resendInviteFn({ data: { email } });
  }, []);

  const updateMemberRole = useCallback(
    async (memberId: string, role: Role) => {
      const { error } = await supabase.rpc("set_member_role", {
        _user_id: memberId,
        _role: toDbRole(role),
      });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    [qc],
  );

  const approveMember = useCallback(
    async (memberId: string) => {
      const { error } = await supabase.rpc("approve_member", { _user_id: memberId });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    [qc],
  );

  const addMemberToTeam = useCallback(
    async (memberId: string, teamId: string) => {
      const { error } = await supabase
        .from("team_members")
        .upsert({ user_id: memberId, team_id: teamId }, { onConflict: "user_id,team_id" });
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["team_members"] });
    },
    [qc],
  );

  const removeMemberFromTeam = useCallback(
    async (memberId: string, teamId: string) => {
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("user_id", memberId)
        .eq("team_id", teamId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["team_members"] });
    },
    [qc],
  );

  const removeUser = useCallback(
    async (memberId: string) => {
      const { removeUserAccess } = await import("@/lib/admin.functions");
      await removeUserAccess({ data: { userId: memberId } });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      qc.invalidateQueries({ queryKey: ["team_members"] });
    },
    [qc],
  );

  const updateProfile = useCallback(
    async (patch: { full_name?: string; job_title?: string; timezone?: string }) => {
      if (!uid) return;
      const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    [uid, qc],
  );

  const employeeHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("employee_hours_range", { _from: from, _to: to });
    throwIf(error);
    return (data ?? []).map((r) => ({ userId: r.user_id, minutes: r.minutes }));
  }, []);

  const employeeClientHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("employee_client_hours_range", {
      _from: from,
      _to: to,
    });
    throwIf(error);
    return (data ?? []).map((r) => ({
      userId: r.user_id,
      clientId: r.client_id,
      minutes: r.minutes,
    }));
  }, []);

  return {
    profilesQ,
    teamMembersQ,
    members,
    activeMembers,
    currentUser,
    isAdmin,
    canManage,
    membersByTeam,
    teamMemberCount,
    memberById,
    invitePeople,
    resendInvite,
    updateMemberRole,
    approveMember,
    addMemberToTeam,
    removeMemberFromTeam,
    removeUser,
    updateProfile,
    employeeHoursForRange,
    employeeClientHoursForRange,
  };
}
