import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
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
  avatarUrl: null,
};

export function useMembersData(enabled: boolean, uid: string | null, session: Session | null) {
  const qc = useQueryClient();

  // L27: a role change, name/title edit, approval, or team assignment made
  // in another tab used to sit stale until something else triggered a
  // refetch — time_entries and timesheets already had this, profiles and
  // team_members never did.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("members_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () =>
        qc.invalidateQueries({ queryKey: ["profiles"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, () =>
        qc.invalidateQueries({ queryKey: ["team_members"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

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
    // L34: this used to be a bare `.then(() => invalidateQueries(...))` with
    // no error check at all — Supabase's query builder resolves with
    // `{ error }` rather than rejecting, so a genuine failure (RLS denial,
    // a real network error) was silently ignored and the person was just
    // left on whatever "no profile yet" state renders, indistinguishable
    // from the app still loading, with no retry affordance. Nothing calls
    // this effect and awaits it — it's a background bootstrap on first
    // sign-in — so there's no caller to propagate an error to; toasting
    // directly here (unlike every other workspace/*.ts hook, which leaves
    // toasting to the calling component) is the only way this specific
    // failure can reach the person at all.
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
      .then(
        ({ error }) => {
          // A 23505 unique-violation means another tab (or a second run of
          // this same effect) already created this exact row first — the
          // correct, safe outcome for this table, not a real failure.
          // Realtime's own "profiles" subscription already picks up that
          // other insert and invalidates for us.
          if (error && error.code !== "23505") {
            toast.error("Couldn't set up your account", {
              id: "profile-bootstrap-error",
              description: "Try refreshing the page. If this keeps happening, contact an admin.",
            });
            return;
          }
          qc.invalidateQueries({ queryKey: ["profiles"] });
        },
        // Supabase's query builder is a PromiseLike, not a real Promise, so
        // a genuine network-level rejection (as opposed to the {error}
        // shape above, which covers Postgres/API errors) only reaches this
        // second .then() callback, not a chained .catch().
        () => {
          toast.error("Couldn't set up your account", {
            id: "profile-bootstrap-error",
            description: "Check your connection, then try refreshing the page.",
          });
        },
      );
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
        avatarUrl: p.avatar_url ?? null,
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

  // L31: client-side check mirrors the "avatars" bucket's own
  // file_size_limit/allowed_mime_types exactly (20260825080000_avatar_storage.sql)
  // — a fast, friendly error here, with the bucket itself as the real
  // backstop, same "client check + DB backstop" shape used everywhere else
  // in this app.
  const uploadAvatar = useCallback(
    async (file: File) => {
      if (!uid) return;
      if (file.type !== "image/png" && file.type !== "image/jpeg") {
        throw new Error("Please choose a PNG or JPG image.");
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new Error("That image is too large — please choose one under 2 MB.");
      }
      // Fixed path per person, no extension — every re-upload overwrites
      // the same object in place (upsert) rather than leaving a stale
      // avatar.png behind after switching to a .jpg, or vice versa.
      const path = `${uid}/avatar`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      throwIf(uploadError);
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      // The storage path never changes, so browsers happily cache the old
      // image against that same URL forever — a query-string cache-buster
      // on the *stored* URL is what makes a re-upload actually show up.
      const avatarUrl = `${publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", uid);
      throwIf(updateError);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    [uid, qc],
  );

  // Lets an admin set someone else's timezone from Manage > Schedule — e.g.
  // a VA who hasn't visited their own Settings yet. RLS's
  // "profiles_update_self_or_admin" policy is admin-only for anyone other
  // than yourself (managers can't), so this is gated to isAdmin in the UI
  // rather than canManage, matching the policy exactly.
  const updateMemberTimezone = useCallback(
    async (memberId: string, timezone: string) => {
      const { error } = await supabase.from("profiles").update({ timezone }).eq("id", memberId);
      throwIf(error);
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    [qc],
  );

  const employeeHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("employee_hours_range", { _from: from, _to: to });
    throwIf(error);
    return (data ?? []).map((r) => ({ userId: r.user_id, minutes: r.minutes }));
  }, []);

  // H17: billable-only hours per employee, for Reports' $ column — separate
  // RPC rather than reusing employee_hours_range's total, since a $ figure
  // has to be billable hours * rate, not total hours * rate.
  const employeeBillableHoursForRange = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc("employee_billable_hours_range", {
      _from: from,
      _to: to,
    });
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
    uploadAvatar,
    updateMemberTimezone,
    employeeHoursForRange,
    employeeBillableHoursForRange,
    employeeClientHoursForRange,
  };
}
