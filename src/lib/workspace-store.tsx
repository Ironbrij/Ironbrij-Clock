import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  combineDateAndTime,
  dayIndexOf,
  fromDateKey,
  startOfWeek,
  toDateKey,
} from "@/lib/time-utils";

type TimeEntryUpdate = Database["public"]["Tables"]["time_entries"]["Update"];

export type Role = "Admin" | "Manager" | "Member";
type DbRole = "admin" | "manager" | "member";

const toRole = (r: DbRole): Role =>
  r === "admin" ? "Admin" : r === "manager" ? "Manager" : "Member";
const toDbRole = (r: Role): DbRole => r.toLowerCase() as DbRole;

export type TimesheetStatus = "Draft" | "Submitted" | "Approved" | "Rejected";
type DbTimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

const toTimesheetStatus = (s: DbTimesheetStatus): TimesheetStatus =>
  s === "submitted"
    ? "Submitted"
    : s === "approved"
      ? "Approved"
      : s === "rejected"
        ? "Rejected"
        : "Draft";
const toDbReviewStatus = (s: "Approved" | "Rejected"): "approved" | "rejected" =>
  s === "Approved" ? "approved" : "rejected";

export const NO_CLIENT = "Internal — no client";

export type Team = { id: string; name: string; color: string };

export type WorkspaceMember = {
  id: string;
  name: string;
  initials: string;
  role: Role;
  title: string;
  teamId: string;
  teamIds: string[];
  email?: string;
  pending?: boolean;
  active: boolean;
  timezone: string;
};

export type WorkspaceProject = {
  id: string;
  name: string;
  client: string;
  clientId: string | null;
  teamId: string;
  color: string;
  hours: number;
  weekHours: number;
  memberIds: string[];
  tagIds: string[];
  billable: boolean;
  archived: boolean;
};

export type WorkspaceTag = { id: string; name: string; color: string; entryCount: number };
export type WorkspaceClient = { id: string; name: string };
export type WorkspaceTaskCategory = { id: string; name: string };

export type WorkspaceSettings = {
  companyName: string;
  logoDataUrl: string | null;
  timezone: string;
  weeklyHours: number;
  currency: string;
  requireDescriptions: boolean;
  allowManualEntry: boolean;
};

export type WorkspaceEntry = {
  id: string;
  projectId: string | null;
  task: string;
  description: string;
  minutes: number;
  startTime: string;
  endTime: string | null;
  date: string;
  running: boolean;
};

export type WorkspaceTimesheet = {
  id: string;
  userId: string;
  weekStart: string;
  status: TimesheetStatus;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

/** A submitted timesheet plus the hours it covers, for a manager/admin's review queue. */
export type PendingApproval = WorkspaceTimesheet & { minutes: number };

export const dotColors = [
  "oklch(0.62 0.15 256)",
  "oklch(0.65 0.16 320)",
  "oklch(0.68 0.15 145)",
  "oklch(0.7 0.16 60)",
  "oklch(0.6 0.15 25)",
  "oklch(0.66 0.13 200)",
  "oklch(0.55 0.1 280)",
  "oklch(0.63 0.14 170)",
  "oklch(0.6 0.17 300)",
  "oklch(0.58 0.12 230)",
];

export const timezones = [
  "Australia/Sydney",
  "Australia/Perth",
  "Asia/Manila",
  "Pacific/Auckland",
  "Europe/London",
  "America/New_York",
];

export const currencies = ["AUD", "USD", "PHP", "NZD", "GBP", "EUR"];

export function initialsFrom(input: string) {
  const clean = input
    .replace(/@.*$/, "")
    .replace(/[._-]+/g, " ")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

export function nameFromEmail(email: string) {
  const local = email
    .replace(/@.*$/, "")
    .replace(/[._-]+/g, " ")
    .trim();
  return (
    local
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ") || email
  );
}

export type ProjectInput = {
  name: string;
  client: string;
  teamId: string;
  color: string;
  billable: boolean;
  tagIds: string[];
  memberIds: string[];
};

type WorkspaceContextValue = {
  session: Session | null;
  authLoading: boolean;
  loading: boolean;
  signOut: () => Promise<void>;

  currentUser: WorkspaceMember;
  isAdmin: boolean;
  canManage: boolean;

  members: WorkspaceMember[];
  activeMembers: WorkspaceMember[];
  teams: Team[];
  projects: WorkspaceProject[];
  tags: WorkspaceTag[];
  createTag: (name: string, color: string) => Promise<void>;
  updateTag: (id: string, name: string, color: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  taskCategories: WorkspaceTaskCategory[];
  createTaskCategory: (name: string) => Promise<void>;
  updateTaskCategory: (id: string, name: string) => Promise<void>;
  deleteTaskCategory: (id: string) => Promise<void>;
  /** The real clients table — every client, whether or not a project currently uses it. Distinct from useWorkspaceClients(), which groups by project usage for display. */
  clients: WorkspaceClient[];
  createClient: (name: string) => Promise<void>;
  updateClient: (id: string, name: string) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  settings: WorkspaceSettings;
  entries: WorkspaceEntry[];
  runningEntry: WorkspaceEntry | null;

  timesheets: WorkspaceTimesheet[];
  /** Submitted timesheets this person can review (empty for plain Members). */
  pendingApprovals: PendingApproval[];
  timesheetForWeek: (weekStart: Date) => WorkspaceTimesheet | undefined;
  submitTimesheet: (weekStart: Date) => Promise<void>;
  reviewTimesheet: (
    timesheetId: string,
    status: "Approved" | "Rejected",
    note?: string,
  ) => Promise<void>;

  membersByTeam: (teamId: string) => WorkspaceMember[];
  teamMemberCount: (teamId: string) => number;
  memberById: (id: string) => WorkspaceMember | undefined;
  projectById: (id: string | null) => WorkspaceProject | undefined;
  /** Hours by project for an arbitrary date range, for the Reports page — not part of the eagerly-loaded state. */
  projectHoursForRange: (
    from: string,
    to: string,
  ) => Promise<{ projectId: string; minutes: number }[]>;
  /** Hours by employee for an arbitrary date range — scoped server-side to self/admin/manager's-team, unlike the project version. */
  employeeHoursForRange: (
    from: string,
    to: string,
  ) => Promise<{ userId: string; minutes: number }[]>;

  invitePeople: (input: { emails: string[]; teamId: string; role: Role }) => Promise<number>;
  resendInvite: (email: string) => Promise<void>;
  updateMemberRole: (memberId: string, role: Role) => Promise<void>;
  approveMember: (memberId: string) => Promise<void>;
  addMemberToTeam: (memberId: string, teamId: string) => Promise<void>;
  removeMemberFromTeam: (memberId: string, teamId: string) => Promise<void>;
  /** Fully revokes access (deletes the auth account) — used for both rejecting a pending signup and removing an active member. */
  removeUser: (memberId: string) => Promise<void>;

  createTeam: (input: { name: string; color: string; memberIds: string[] }) => Promise<void>;
  updateTeam: (teamId: string, input: { name: string; color: string }) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;

  createProject: (input: ProjectInput) => Promise<void>;
  updateProject: (projectId: string, input: ProjectInput) => Promise<void>;
  archiveProject: (projectId: string) => Promise<void>;

  updateSettings: (patch: Partial<WorkspaceSettings>) => Promise<void>;
  updateProfile: (patch: {
    full_name?: string;
    job_title?: string;
    timezone?: string;
  }) => Promise<void>;

  startTimer: (input: { projectId: string; task: string; description: string }) => Promise<void>;
  stopTimer: (entryId: string) => Promise<void>;
  createEntry: (input: {
    projectId: string;
    task: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => Promise<void>;
  updateEntry: (
    entryId: string,
    patch: {
      projectId?: string;
      task?: string;
      description?: string;
      date?: string;
      startTime?: string;
      endTime?: string;
    },
  ) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  refreshAll: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthLoading(false);
      qc.invalidateQueries();
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id ?? null;
  const enabled = !!uid;

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

  const teamsQ = useQuery({
    queryKey: ["teams"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, color")
        .order("created_at");
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

  const clientsQ = useQuery({
    queryKey: ["clients"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const tagsQ = useQuery({
    queryKey: ["tags"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("tags").select("id, name, color").order("name");
      if (error) throw error;
      return data;
    },
  });

  const taskCategoriesQ = useQuery({
    queryKey: ["task_categories"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_categories")
        .select("id, name")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const tagUsageQ = useQuery({
    queryKey: ["tag_usage"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tag_usage");
      if (error) throw error;
      return data;
    },
  });

  const projectsQ = useQuery({
    queryKey: ["projects"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id, team_id, color, is_billable, is_archived")
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

  const entriesQ = useQuery({
    queryKey: ["time_entries", uid],
    enabled,
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - 60);
      const { data, error } = await supabase
        .from("time_entries")
        .select(
          "id, project_id, task, description, start_time, end_time, entry_date, duration_minutes, is_billable",
        )
        .eq("user_id", uid!)
        .gte("entry_date", toDateKey(from))
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const timesheetsQ = useQuery({
    queryKey: ["timesheets"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timesheets")
        .select(
          "id, user_id, week_start, status, submitted_at, reviewed_by, reviewed_at, review_note",
        )
        .order("week_start", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingReviewRaw = useMemo(
    () => (timesheetsQ.data ?? []).filter((t) => t.status === "submitted"),
    [timesheetsQ.data],
  );

  // Only fetched once there's something to review, and scoped to just the
  // people/weeks involved — RLS already limits this to entries the viewer
  // (a manager on a shared team, or an admin) is allowed to see.
  const reviewEntriesQ = useQuery({
    queryKey: [
      "review_entries",
      pendingReviewRaw
        .map((t) => t.id)
        .sort()
        .join(","),
    ],
    enabled: enabled && pendingReviewRaw.length > 0,
    queryFn: async () => {
      const userIds = Array.from(new Set(pendingReviewRaw.map((t) => t.user_id)));
      const earliest = pendingReviewRaw.reduce(
        (min, t) => (t.week_start < min ? t.week_start : min),
        pendingReviewRaw[0].week_start,
      );
      const { data, error } = await supabase
        .from("time_entries")
        .select("user_id, entry_date, duration_minutes")
        .in("user_id", userIds)
        .gte("entry_date", earliest);
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

  const teams = useMemo<Team[]>(() => teamsQ.data ?? [], [teamsQ.data]);

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

  const tags = useMemo<WorkspaceTag[]>(() => {
    const usage = tagUsageQ.data ?? [];
    return (tagsQ.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      entryCount: usage.find((u) => u.tag_id === t.id)?.entry_count ?? 0,
    }));
  }, [tagsQ.data, tagUsageQ.data]);

  const taskCategories = useMemo<WorkspaceTaskCategory[]>(
    () => (taskCategoriesQ.data ?? []).map((t) => ({ id: t.id, name: t.name })),
    [taskCategoriesQ.data],
  );

  const clients = useMemo<WorkspaceClient[]>(
    () => (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clientsQ.data],
  );

  const projects = useMemo<WorkspaceProject[]>(() => {
    const clients = clientsQ.data ?? [];
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
      };
    });
  }, [projectsQ.data, clientsQ.data, projectMembersQ.data, projectTagsQ.data, projectHoursQ.data]);

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

  const entries = useMemo<WorkspaceEntry[]>(
    () =>
      (entriesQ.data ?? []).map((e) => ({
        id: e.id,
        projectId: e.project_id,
        task: e.task ?? "",
        description: e.description,
        minutes: e.duration_minutes ?? 0,
        startTime: e.start_time,
        endTime: e.end_time,
        date: e.entry_date,
        running: !e.end_time,
      })),
    [entriesQ.data],
  );

  const runningEntry = useMemo(() => entries.find((e) => e.running) ?? null, [entries]);

  const timesheets = useMemo<WorkspaceTimesheet[]>(
    () =>
      (timesheetsQ.data ?? []).map((t) => ({
        id: t.id,
        userId: t.user_id,
        weekStart: t.week_start,
        status: toTimesheetStatus(t.status as DbTimesheetStatus),
        submittedAt: t.submitted_at,
        reviewedBy: t.reviewed_by,
        reviewedAt: t.reviewed_at,
        reviewNote: t.review_note,
      })),
    [timesheetsQ.data],
  );

  const pendingApprovals = useMemo<PendingApproval[]>(() => {
    const rows = reviewEntriesQ.data ?? [];
    return timesheets
      .filter((t) => t.status === "Submitted")
      .map((t) => {
        const start = fromDateKey(t.weekStart);
        const minutes = rows
          .filter((r) => r.user_id === t.userId)
          .filter((r) => {
            const idx = dayIndexOf(r.entry_date, start);
            return idx >= 0 && idx <= 6;
          })
          .reduce((sum, r) => sum + (r.duration_minutes ?? 0), 0);
        return { ...t, minutes };
      });
  }, [timesheets, reviewEntriesQ.data]);

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

  const membersByTeam = useCallback(
    (teamId: string) => members.filter((m) => m.teamIds.includes(teamId)),
    [members],
  );

  const timesheetForWeek = useCallback(
    (weekStart: Date) => {
      const key = toDateKey(weekStart);
      return timesheets.find((t) => t.userId === uid && t.weekStart === key);
    },
    [timesheets, uid],
  );

  const invalidate = useCallback(
    (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    [qc],
  );

  const resolveClientId = useCallback(
    (name: string) => (clientsQ.data ?? []).find((c) => c.name === name)?.id ?? null,
    [clientsQ.data],
  );

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

  const loading =
    enabled &&
    (profilesQ.isLoading ||
      teamsQ.isLoading ||
      projectsQ.isLoading ||
      tagsQ.isLoading ||
      settingsQ.isLoading ||
      timesheetsQ.isLoading ||
      taskCategoriesQ.isLoading);

  const value = useMemo<WorkspaceContextValue>(() => {
    const throwIf = (error: { message: string } | null) => {
      if (error) throw new Error(error.message);
    };

    return {
      session,
      authLoading,
      loading,
      signOut: async () => {
        await qc.cancelQueries();
        qc.clear();
        await supabase.auth.signOut();
      },
      currentUser,
      isAdmin: currentUser.role === "Admin",
      canManage: currentUser.role === "Admin" || currentUser.role === "Manager",
      members,
      activeMembers,
      teams,
      projects,
      tags,
      taskCategories,
      clients,
      settings,
      entries,
      runningEntry,
      timesheets,
      pendingApprovals,
      timesheetForWeek,
      membersByTeam,
      teamMemberCount: (teamId) => membersByTeam(teamId).length,
      memberById: (id) => members.find((m) => m.id === id),
      projectById: (id) => (id ? projects.find((p) => p.id === id) : undefined),
      projectHoursForRange: async (from, to) => {
        const { data, error } = await supabase.rpc("project_hours_range", { _from: from, _to: to });
        throwIf(error);
        return (data ?? []).map((r) => ({ projectId: r.project_id, minutes: r.minutes }));
      },
      employeeHoursForRange: async (from, to) => {
        const { data, error } = await supabase.rpc("employee_hours_range", {
          _from: from,
          _to: to,
        });
        throwIf(error);
        return (data ?? []).map((r) => ({ userId: r.user_id, minutes: r.minutes }));
      },

      invitePeople: async ({ emails, teamId, role }) => {
        const { inviteMembers } = await import("@/lib/admin.functions");
        const result = await inviteMembers({
          data: {
            emails,
            teamId,
            role: toDbRole(role),
            redirectTo: typeof window === "undefined" ? undefined : window.location.origin,
          },
        });
        invalidate("profiles", "team_members");
        return result.invited;
      },
      resendInvite: async (email) => {
        const { resendInvite } = await import("@/lib/admin.functions");
        await resendInvite({ data: { email } });
      },
      updateMemberRole: async (memberId, role) => {
        const { error } = await supabase.rpc("set_member_role", {
          _user_id: memberId,
          _role: toDbRole(role),
        });
        throwIf(error);
        invalidate("profiles");
      },
      approveMember: async (memberId) => {
        const { error } = await supabase.rpc("approve_member", { _user_id: memberId });
        throwIf(error);
        invalidate("profiles");
      },
      addMemberToTeam: async (memberId, teamId) => {
        const { error } = await supabase
          .from("team_members")
          .upsert({ user_id: memberId, team_id: teamId }, { onConflict: "user_id,team_id" });
        throwIf(error);
        invalidate("team_members");
      },
      removeMemberFromTeam: async (memberId, teamId) => {
        const { error } = await supabase
          .from("team_members")
          .delete()
          .eq("user_id", memberId)
          .eq("team_id", teamId);
        throwIf(error);
        invalidate("team_members");
      },
      removeUser: async (memberId) => {
        const { removeUserAccess } = await import("@/lib/admin.functions");
        await removeUserAccess({ data: { userId: memberId } });
        invalidate("profiles", "team_members");
      },

      createTeam: async ({ name, color, memberIds }) => {
        const { data, error } = await supabase
          .from("teams")
          .insert({ name, color })
          .select("id")
          .single();
        throwIf(error);
        if (data && memberIds.length) {
          await supabase
            .from("team_members")
            .insert(memberIds.map((user_id) => ({ user_id, team_id: data.id })));
        }
        invalidate("teams", "team_members");
      },
      updateTeam: async (teamId, input) => {
        const { error } = await supabase.from("teams").update(input).eq("id", teamId);
        throwIf(error);
        invalidate("teams");
      },
      deleteTeam: async (teamId) => {
        const { error } = await supabase.from("teams").delete().eq("id", teamId);
        throwIf(error);
        invalidate("teams", "team_members", "projects");
      },

      createTaskCategory: async (name) => {
        const { error } = await supabase.from("task_categories").insert({ name: name.trim() });
        throwIf(error);
        invalidate("task_categories");
      },
      updateTaskCategory: async (id, name) => {
        const { error } = await supabase
          .from("task_categories")
          .update({ name: name.trim() })
          .eq("id", id);
        throwIf(error);
        invalidate("task_categories");
      },
      deleteTaskCategory: async (id) => {
        const { error } = await supabase.from("task_categories").delete().eq("id", id);
        throwIf(error);
        invalidate("task_categories");
      },

      createClient: async (name) => {
        const { error } = await supabase.from("clients").insert({ name: name.trim() });
        throwIf(error);
        invalidate("clients");
      },
      updateClient: async (id, name) => {
        const { error } = await supabase.from("clients").update({ name: name.trim() }).eq("id", id);
        throwIf(error);
        invalidate("clients");
      },
      deleteClient: async (id) => {
        const { error } = await supabase.from("clients").delete().eq("id", id);
        throwIf(error);
        invalidate("clients", "projects");
      },

      createTag: async (name, color) => {
        const { error } = await supabase.from("tags").insert({ name: name.trim(), color });
        throwIf(error);
        invalidate("tags");
      },
      updateTag: async (id, name, color) => {
        const { error } = await supabase
          .from("tags")
          .update({ name: name.trim(), color })
          .eq("id", id);
        throwIf(error);
        invalidate("tags");
      },
      deleteTag: async (id) => {
        const { error } = await supabase.from("tags").delete().eq("id", id);
        throwIf(error);
        invalidate("tags", "projects", "tag_usage");
      },

      createProject: async (input) => {
        const { data, error } = await supabase
          .from("projects")
          .insert({
            name: input.name,
            client_id: resolveClientId(input.client),
            team_id: input.teamId || null,
            color: input.color,
            is_billable: input.billable,
          })
          .select("id")
          .single();
        throwIf(error);
        if (data) await writeProjectLinks(data.id, input.tagIds, input.memberIds);
        invalidate("projects", "project_members", "project_tags", "project_hours");
      },
      updateProject: async (projectId, input) => {
        const { error } = await supabase
          .from("projects")
          .update({
            name: input.name,
            client_id: resolveClientId(input.client),
            team_id: input.teamId || null,
            color: input.color,
            is_billable: input.billable,
          })
          .eq("id", projectId);
        throwIf(error);
        await writeProjectLinks(projectId, input.tagIds, input.memberIds);
        invalidate("projects", "project_members", "project_tags");
      },
      archiveProject: async (projectId) => {
        const { error } = await supabase
          .from("projects")
          .update({ is_archived: true })
          .eq("id", projectId);
        throwIf(error);
        invalidate("projects");
      },

      updateSettings: async (patch) => {
        const row: Record<string, unknown> = { id: true };
        if (patch.companyName !== undefined) row["company_name"] = patch.companyName;
        if (patch.logoDataUrl !== undefined) row["logo_url"] = patch.logoDataUrl;
        if (patch.timezone !== undefined) row["timezone"] = patch.timezone;
        if (patch.weeklyHours !== undefined) row["weekly_hours"] = patch.weeklyHours;
        if (patch.currency !== undefined) row["currency"] = patch.currency;
        if (patch.requireDescriptions !== undefined)
          row["require_descriptions"] = patch.requireDescriptions;
        if (patch.allowManualEntry !== undefined)
          row["allow_manual_entry"] = patch.allowManualEntry;
        const { error } = await supabase.from("workspace_settings").upsert(row as never);
        throwIf(error);
        invalidate("workspace_settings");
      },
      updateProfile: async (patch) => {
        if (!uid) return;
        const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
        throwIf(error);
        invalidate("profiles");
      },

      startTimer: async ({ projectId, task, description }) => {
        if (!uid) return;
        const project = projects.find((p) => p.id === projectId);
        const now = new Date();
        const { error } = await supabase.from("time_entries").insert({
          user_id: uid,
          project_id: projectId,
          task,
          description,
          start_time: now.toISOString(),
          entry_date: toDateKey(now),
          is_billable: project?.billable ?? true,
          tag_ids: project?.tagIds ?? [],
        });
        throwIf(error);
        invalidate("time_entries", "project_hours", "tag_usage");
      },
      stopTimer: async (entryId) => {
        const entry = entries.find((e) => e.id === entryId);
        if (!entry) return;
        const end = new Date();
        const minutes = Math.max(
          1,
          Math.round((end.getTime() - new Date(entry.startTime).getTime()) / 60000),
        );
        const { error } = await supabase
          .from("time_entries")
          .update({ end_time: end.toISOString(), duration_minutes: minutes })
          .eq("id", entryId);
        throwIf(error);
        invalidate("time_entries", "project_hours", "tag_usage");
      },
      updateEntry: async (entryId, patch) => {
        const dbPatch: TimeEntryUpdate = {};
        if (patch.projectId !== undefined) dbPatch.project_id = patch.projectId;
        if (patch.task !== undefined) dbPatch.task = patch.task;
        if (patch.description !== undefined) dbPatch.description = patch.description;

        if (
          patch.date !== undefined ||
          patch.startTime !== undefined ||
          patch.endTime !== undefined
        ) {
          const existing = entries.find((e) => e.id === entryId);
          if (!existing) throw new Error("Entry not found.");
          const date = patch.date ?? existing.date;
          const existingStart = new Date(existing.startTime);
          const existingEnd = existing.endTime ? new Date(existing.endTime) : existingStart;
          const pad = (n: number) => String(n).padStart(2, "0");
          const startTime =
            patch.startTime ??
            `${pad(existingStart.getHours())}:${pad(existingStart.getMinutes())}`;
          const endTime =
            patch.endTime ?? `${pad(existingEnd.getHours())}:${pad(existingEnd.getMinutes())}`;
          const start = combineDateAndTime(date, startTime);
          const end = combineDateAndTime(date, endTime);
          const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
          if (minutes <= 0) throw new Error("End time must be after start time.");
          dbPatch.entry_date = date;
          dbPatch.start_time = start.toISOString();
          dbPatch.end_time = end.toISOString();
          dbPatch.duration_minutes = minutes;
        }

        const { error } = await supabase.from("time_entries").update(dbPatch).eq("id", entryId);
        throwIf(error);
        invalidate("time_entries", "project_hours", "tag_usage");
      },
      createEntry: async (input) => {
        if (!uid) return;
        const project = projects.find((p) => p.id === input.projectId);
        const start = combineDateAndTime(input.date, input.startTime);
        const end = combineDateAndTime(input.date, input.endTime);
        const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
        if (minutes <= 0) throw new Error("End time must be after start time.");
        const { error } = await supabase.from("time_entries").insert({
          user_id: uid,
          project_id: input.projectId,
          task: input.task,
          description: input.description,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          entry_date: input.date,
          duration_minutes: minutes,
          is_billable: project?.billable ?? true,
          tag_ids: project?.tagIds ?? [],
        });
        throwIf(error);
        invalidate("time_entries", "project_hours", "tag_usage");
      },
      deleteEntry: async (entryId) => {
        const { error } = await supabase.from("time_entries").delete().eq("id", entryId);
        throwIf(error);
        invalidate("time_entries", "project_hours", "tag_usage");
      },

      submitTimesheet: async (weekStart) => {
        const { error } = await supabase.rpc("submit_timesheet", {
          _week_start: toDateKey(weekStart),
        });
        throwIf(error);
        invalidate("timesheets");
      },
      reviewTimesheet: async (timesheetId, status, note) => {
        const { error } = await supabase.rpc("review_timesheet", {
          _timesheet_id: timesheetId,
          _status: toDbReviewStatus(status),
          _note: note,
        });
        throwIf(error);
        invalidate("timesheets", "time_entries", "review_entries");
      },
      refreshAll: () => qc.invalidateQueries(),
    };
  }, [
    session,
    authLoading,
    loading,
    currentUser,
    members,
    activeMembers,
    teams,
    projects,
    tags,
    taskCategories,
    clients,
    settings,
    entries,
    runningEntry,
    timesheets,
    pendingApprovals,
    timesheetForWeek,
    membersByTeam,
    invalidate,
    resolveClientId,
    writeProjectLinks,
    qc,
    uid,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function useWorkspaceTags() {
  return useWorkspace().tags;
}

export function useWorkspaceClients() {
  const { projects } = useWorkspace();
  return useMemo(() => {
    const names = Array.from(new Set(projects.map((p) => p.client)));
    return names.map((name) => {
      const linked = projects.filter((p) => p.client === name);
      return {
        name,
        projects: linked,
        hours: linked.reduce((sum, p) => sum + p.hours, 0),
        internal: name === NO_CLIENT,
      };
    });
  }, [projects]);
}

/** Hours per project per weekday for the given week, from the signed-in person's entries. */
export function useWeekGrid(weekStart: Date) {
  const { entries } = useWorkspace();
  return useMemo(() => {
    const grid: Record<string, number[]> = {};
    for (const e of entries) {
      if (!e.projectId) continue;
      const idx = dayIndexOf(e.date, weekStart);
      if (idx < 0 || idx > 6) continue;
      grid[e.projectId] ??= [0, 0, 0, 0, 0, 0, 0];
      grid[e.projectId][idx] += e.minutes / 60;
    }
    return grid;
  }, [entries, weekStart]);
}

export function useThisWeekStart() {
  return useMemo(() => startOfWeek(new Date()), []);
}
