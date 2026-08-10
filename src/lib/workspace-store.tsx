import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { dayIndexOf, startOfWeek } from "@/lib/time-utils";
import {
  currencies,
  dotColors,
  initialsFrom,
  nameFromEmail,
  NO_CLIENT,
  timezones,
  toDbReviewStatus,
  toTimesheetStatus,
  type DbTimesheetStatus,
  type PendingApproval,
  type ProjectInput,
  type Role,
  type Team,
  type TimesheetStatus,
  type WorkspaceClient,
  type WorkspaceEntry,
  type WorkspaceMember,
  type WorkspaceProject,
  type WorkspaceSettings,
  type WorkspaceTag,
  type WorkspaceTaskCategory,
  type WorkspaceTimesheet,
} from "@/lib/workspace/types";
import { useClientsData } from "@/lib/workspace/use-clients";
import { useMembersData } from "@/lib/workspace/use-members";
import { useProjectsData } from "@/lib/workspace/use-projects";
import { useActivityLogData, type WorkspaceActivityEvent } from "@/lib/workspace/use-activity-log";
import { useSettingsData } from "@/lib/workspace/use-settings";
import { useTeamsData } from "@/lib/workspace/use-teams";
import { useTimeEntriesData } from "@/lib/workspace/use-time-entries";
import { useTimesheetsData } from "@/lib/workspace/use-timesheets";
import { useTagsData } from "@/lib/workspace/use-tags";
import { useTaskCategoriesData } from "@/lib/workspace/use-task-categories";

// Re-exported under the exact same names so every existing import from
// "@/lib/workspace-store" throughout the app keeps working unchanged —
// this file's public API is identical to before the split, only its
// internals are now spread across src/lib/workspace/*.
export {
  currencies,
  dotColors,
  initialsFrom,
  nameFromEmail,
  NO_CLIENT,
  timezones,
  type PendingApproval,
  type ProjectInput,
  type Role,
  type Team,
  type TimesheetStatus,
  type WorkspaceActivityEvent,
  type WorkspaceClient,
  type WorkspaceEntry,
  type WorkspaceMember,
  type WorkspaceProject,
  type WorkspaceSettings,
  type WorkspaceTag,
  type WorkspaceTaskCategory,
  type WorkspaceTimesheet,
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
  setClientActive: (id: string, active: boolean) => Promise<void>;
  updateClientProfile: (
    id: string,
    profile: {
      basecampUrl: string | null;
      contactName: string | null;
      contactEmail: string | null;
      subscriptionHours: number | null;
    },
  ) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  settings: WorkspaceSettings;
  entries: WorkspaceEntry[];
  runningEntry: WorkspaceEntry | null;

  timesheets: WorkspaceTimesheet[];
  /** Submitted timesheets this person can review (empty for plain Members). */
  pendingApprovals: PendingApproval[];
  /** Recent workspace activity for the Manage → Activity tab — empty for anyone who isn't a manager/admin. */
  activityLog: WorkspaceActivityEvent[];
  /** How many activity events happened since the person last opened the Activity tab. */
  unseenActivityCount: number;
  markActivitySeen: () => void;
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
  /** Hours by employee, broken down per client, for the Reports client filter. clientId is null for entries with no client attached. */
  employeeClientHoursForRange: (
    from: string,
    to: string,
  ) => Promise<{ userId: string; clientId: string | null; minutes: number }[]>;
  /** Entries carrying a given tag — relies entirely on time_entries' own RLS (self/admin/manager-shares-team) for who can see what, same as everywhere else. */
  entriesForTag: (tagId: string) => Promise<
    {
      id: string;
      userId: string;
      projectId: string | null;
      description: string;
      date: string;
      minutes: number;
    }[]
  >;

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
  unarchiveProject: (projectId: string) => Promise<void>;
  /** Permanently deletes a project. Time entries logged against it are kept (SET NULL), not deleted — they'll show as having no project. */
  deleteProject: (projectId: string) => Promise<void>;

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

  const {
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
  } = useMembersData(enabled, uid, session);

  const { activityLogQ, activityLog, unseenActivityCount, markActivitySeen } = useActivityLogData(
    enabled,
    canManage,
  );

  const { teamsQ, teams, createTeam, updateTeam, deleteTeam } = useTeamsData(enabled);

  const {
    clientsQ,
    clients,
    resolveClientId,
    createClient,
    updateClient,
    setClientActive,
    updateClientProfile,
    deleteClient,
  } = useClientsData(enabled);

  const { tagsQ, tagUsageQ, tags, createTag, updateTag, deleteTag } = useTagsData(enabled);

  const {
    taskCategoriesQ,
    taskCategories,
    createTaskCategory,
    updateTaskCategory,
    deleteTaskCategory,
  } = useTaskCategoriesData(enabled);

  const {
    projectsQ,
    projectMembersQ,
    projectTagsQ,
    projectHoursQ,
    projects,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    deleteProject,
    projectHoursForRange,
  } = useProjectsData(enabled, clientsQ.data, resolveClientId);

  const { settingsQ, settings, updateSettings } = useSettingsData(enabled);

  const {
    entriesQ,
    entries,
    runningEntry,
    startTimer,
    stopTimer,
    updateEntry,
    createEntry,
    deleteEntry,
    entriesForTag,
  } = useTimeEntriesData(enabled, uid, projects);

  const {
    timesheetsQ,
    reviewEntriesQ,
    timesheets,
    pendingApprovals,
    timesheetForWeek,
    submitTimesheet,
    reviewTimesheet,
  } = useTimesheetsData(enabled, uid);

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
      isAdmin,
      canManage,
      members,
      activeMembers,
      teams,
      createTeam,
      updateTeam,
      deleteTeam,
      projects,
      createProject,
      updateProject,
      archiveProject,
      unarchiveProject,
      deleteProject,
      projectHoursForRange,
      tags,
      createTag,
      updateTag,
      deleteTag,
      taskCategories,
      createTaskCategory,
      updateTaskCategory,
      deleteTaskCategory,
      clients,
      createClient,
      updateClient,
      setClientActive,
      updateClientProfile,
      deleteClient,
      settings,
      updateSettings,
      entries,
      runningEntry,
      timesheets,
      pendingApprovals,
      activityLog,
      unseenActivityCount,
      markActivitySeen,
      timesheetForWeek,
      membersByTeam,
      teamMemberCount,
      memberById,
      projectById: (id) => (id ? projects.find((p) => p.id === id) : undefined),
      employeeHoursForRange,
      employeeClientHoursForRange,
      entriesForTag,
      invitePeople,
      resendInvite,
      updateMemberRole,
      approveMember,
      addMemberToTeam,
      removeMemberFromTeam,
      removeUser,
      updateProfile,

      startTimer,
      stopTimer,
      updateEntry,
      createEntry,
      deleteEntry,

      submitTimesheet,
      reviewTimesheet,
      refreshAll: () => qc.invalidateQueries(),
    };
  }, [
    session,
    authLoading,
    loading,
    currentUser,
    isAdmin,
    canManage,
    members,
    activeMembers,
    memberById,
    teamMemberCount,
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
    teams,
    createTeam,
    updateTeam,
    deleteTeam,
    projects,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    deleteProject,
    projectHoursForRange,
    tags,
    createTag,
    updateTag,
    deleteTag,
    taskCategories,
    createTaskCategory,
    updateTaskCategory,
    deleteTaskCategory,
    clients,
    createClient,
    updateClient,
    setClientActive,
    updateClientProfile,
    deleteClient,
    settings,
    updateSettings,
    entries,
    runningEntry,
    startTimer,
    stopTimer,
    updateEntry,
    createEntry,
    deleteEntry,
    entriesForTag,
    timesheets,
    pendingApprovals,
    activityLog,
    unseenActivityCount,
    markActivitySeen,
    timesheetForWeek,
    submitTimesheet,
    reviewTimesheet,
    membersByTeam,
    qc,
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
