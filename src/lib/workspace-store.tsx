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
  type DaySchedule,
  type DbTimesheetStatus,
  type DetailedEntry,
  type EmploymentType,
  type PendingApproval,
  type PendingApprovalEntry,
  type ProjectInput,
  type Role,
  type Team,
  type TimesheetStatus,
  type WorkspaceAnnouncement,
  type WorkspaceClient,
  type WorkspaceEmployment,
  type WorkspaceEntry,
  type WorkspaceMember,
  type WorkspaceProject,
  type WorkspaceSettings,
  type WorkspaceTag,
  type WorkspaceTaskCategory,
  type WorkspaceTimesheet,
  type WeeklyScheduleDays,
} from "@/lib/workspace/types";
import { useAnnouncementsData } from "@/lib/workspace/use-announcements";
import { useClientsData } from "@/lib/workspace/use-clients";
import { useEmploymentData } from "@/lib/workspace/use-employment";
import { useMembersData } from "@/lib/workspace/use-members";
import { useProjectsData } from "@/lib/workspace/use-projects";
import { useActivityLogData, type WorkspaceActivityEvent } from "@/lib/workspace/use-activity-log";
import { useSettingsData } from "@/lib/workspace/use-settings";
import { useTeamsData } from "@/lib/workspace/use-teams";
import {
  useActiveTimersData,
  useMemberEntriesData,
  useTimeEntriesData,
  type ActiveTimer,
} from "@/lib/workspace/use-time-entries";
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
  type ActiveTimer,
  type DaySchedule,
  type DetailedEntry,
  type EmploymentType,
  type PendingApproval,
  type PendingApprovalEntry,
  type ProjectInput,
  type Role,
  type Team,
  type TimesheetStatus,
  type WorkspaceActivityEvent,
  type WorkspaceClient,
  type WorkspaceEmployment,
  type WorkspaceEntry,
  type WorkspaceMember,
  type WorkspaceProject,
  type WorkspaceSettings,
  type WorkspaceAnnouncement,
  type WorkspaceTag,
  type WorkspaceTaskCategory,
  type WorkspaceTimesheet,
  type WeeklyScheduleDays,
};

type WorkspaceContextValue = {
  session: Session | null;
  authLoading: boolean;
  loading: boolean;
  /** True if one of the core "shell" queries (profile, teams, projects, tags, settings, timesheets, task categories) failed outright — distinct from `loading` so AppShell can show a real error instead of quietly rendering every page as if it were empty. */
  loadError: boolean;
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
  /** Submitted timesheets this person can review (empty for plain Members, and never includes their own). */
  pendingApprovals: PendingApproval[];
  /** The actual entries behind a pending approval's total — so a reviewer can see what they're approving, not just a number. */
  entriesForApproval: (approval: PendingApproval) => PendingApprovalEntry[];
  /** Recent workspace activity for the Manage → Activity tab — empty for anyone who isn't a manager/admin. */
  activityLog: WorkspaceActivityEvent[];
  /** How many activity events happened since the person last opened the Activity tab. */
  unseenActivityCount: number;
  markActivitySeen: () => void;
  /** Announcements visible to this member — RLS already scopes this to 'everyone' posts plus any team-targeted post they're on the receiving team for. */
  announcements: WorkspaceAnnouncement[];
  /** How many announcements were posted since the person last opened the Announcements page. */
  unseenAnnouncementCount: number;
  markAnnouncementsSeen: () => void;
  /** Admins can target 'everyone' or any team(s); managers are restricted server-side to team(s) they belong to. */
  createAnnouncement: (input: {
    title: string;
    body: string;
    audience: "everyone" | "teams";
    teamIds: string[];
  }) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
  /** Rate/schedule/employment-type per member, for Manage → Schedule — empty for anyone who isn't a manager/admin. */
  employmentByUser: Map<string, WorkspaceEmployment>;
  updateMemberEmployment: (
    userId: string,
    patch: {
      employmentType?: EmploymentType;
      hourlyRate?: number | null;
      weeklySchedule?: string | null;
      weeklyScheduleDays?: WeeklyScheduleDays | null;
    },
  ) => Promise<void>;
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
  /** M28: billable-only hours by project, for Reports' billable/non-billable split — summed from time_entries.is_billable, not projects.is_billable. */
  projectBillableHoursForRange: (
    from: string,
    to: string,
  ) => Promise<{ projectId: string; minutes: number }[]>;
  /** Hours by employee for an arbitrary date range — scoped server-side to self/admin/manager's-team, unlike the project version. */
  employeeHoursForRange: (
    from: string,
    to: string,
  ) => Promise<{ userId: string; minutes: number }[]>;
  /** H17: billable-only hours by employee, for Reports' $ column — hours * hourly_rate has to use billable hours specifically, not the total from employeeHoursForRange. */
  employeeBillableHoursForRange: (
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
  /** H16: every entry in a date range that time_entries' own RLS lets the viewer see — backs the Reports page's Detailed tab. */
  detailedEntriesForRange: (from: string, to: string) => Promise<DetailedEntry[]>;

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
  /** L31: uploads to the "avatars" Storage bucket at a fixed per-person path (upsert, so a re-upload replaces in place), then writes the resulting public URL to profiles.avatar_url. Throws a friendly error for a non-PNG/JPG file or one over 2 MB, mirroring the bucket's own limits. */
  uploadAvatar: (file: File) => Promise<void>;
  /** Admin-only (matches the profiles RLS policy exactly) — sets another member's timezone, e.g. from Manage > Schedule. */
  updateMemberTimezone: (memberId: string, timezone: string) => Promise<void>;

  startTimer: (input: {
    projectId: string | null;
    task: string;
    description: string;
  }) => Promise<void>;
  /**
   * Stops a running entry, splitting it into one row per calendar day if it
   * ran past midnight. Pass the description currently shown in the timer
   * bar — it's saved to the entry along with the stop time, since nothing
   * else persists description edits made while the timer is running.
   */
  stopTimer: (entryId: string, description?: string) => Promise<{ splitAcrossDays: boolean }>;
  createEntry: (input: {
    projectId: string;
    task: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
    /** M21: only needed for a shift that runs past midnight — defaults to `date` when omitted. */
    endDate?: string;
    /** M26: omit to fall back to the project's own billable default. */
    billable?: boolean;
  }) => Promise<void>;
  updateEntry: (
    entryId: string,
    patch: {
      projectId?: string;
      task?: string;
      description?: string;
      /** M26: independent of the project's own default — omit for no change. */
      billable?: boolean;
      date?: string;
      startTime?: string;
      /** `null` means "still running, leave it open" — see use-time-entries.ts's updateEntry. */
      endTime?: string | null;
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
    uploadAvatar,
    updateMemberTimezone,
    employeeHoursForRange,
    employeeBillableHoursForRange,
    employeeClientHoursForRange,
  } = useMembersData(enabled, uid, session);

  const { activityLogQ, activityLog, unseenActivityCount, markActivitySeen } = useActivityLogData(
    enabled,
    canManage,
  );

  const {
    announcementsQ,
    announcements,
    unseenAnnouncementCount,
    markAnnouncementsSeen,
    createAnnouncement,
    deleteAnnouncement,
  } = useAnnouncementsData(enabled);

  const { employmentQ, employmentByUser, updateMemberEmployment } = useEmploymentData(
    enabled,
    canManage,
    uid,
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
    projectTaskCategoriesQ,
    projectHoursQ,
    projects,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    deleteProject,
    projectHoursForRange,
    projectBillableHoursForRange,
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
    detailedEntriesForRange,
  } = useTimeEntriesData(enabled, uid, projects, settings);

  const {
    timesheetsQ,
    reviewEntriesQ,
    timesheets,
    pendingApprovals,
    entriesForApproval,
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

  // Same query set `loading` watches — if one of these comes back an
  // outright error (not just slow), AppShell needs to say so instead of
  // rendering every page as if the workspace were simply empty.
  const loadError =
    enabled &&
    (profilesQ.isError ||
      teamsQ.isError ||
      projectsQ.isError ||
      tagsQ.isError ||
      settingsQ.isError ||
      timesheetsQ.isError ||
      taskCategoriesQ.isError);

  const value = useMemo<WorkspaceContextValue>(() => {
    const throwIf = (error: { message: string } | null) => {
      if (error) throw new Error(error.message);
    };

    return {
      session,
      authLoading,
      loading,
      loadError,
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
      projectBillableHoursForRange,
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
      entriesForApproval,
      activityLog,
      unseenActivityCount,
      markActivitySeen,
      announcements,
      unseenAnnouncementCount,
      markAnnouncementsSeen,
      createAnnouncement,
      deleteAnnouncement,
      employmentByUser,
      updateMemberEmployment,
      timesheetForWeek,
      membersByTeam,
      teamMemberCount,
      memberById,
      projectById: (id) => (id ? projects.find((p) => p.id === id) : undefined),
      employeeHoursForRange,
      employeeBillableHoursForRange,
      employeeClientHoursForRange,
      entriesForTag,
      detailedEntriesForRange,
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
    loadError,
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
    uploadAvatar,
    updateMemberTimezone,
    employeeHoursForRange,
    employeeBillableHoursForRange,
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
    projectBillableHoursForRange,
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
    detailedEntriesForRange,
    timesheets,
    pendingApprovals,
    entriesForApproval,
    activityLog,
    unseenActivityCount,
    markActivitySeen,
    announcements,
    unseenAnnouncementCount,
    markAnnouncementsSeen,
    createAnnouncement,
    deleteAnnouncement,
    employmentByUser,
    updateMemberEmployment,
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

export type ClientBudgetStatus = {
  clientId: string;
  subscriptionHours: number;
  renderedHours: number;
  remainingHours: number;
  /** Every subscription hour has already been used (or exceeded). */
  isOver: boolean;
  /** Not over yet, but within BUDGET_WARNING_THRESHOLD of the cap — a heads-up before it actually runs out. */
  isNearLimit: boolean;
};

const BUDGET_WARNING_THRESHOLD = 0.9;

/**
 * Budget status for every client that has a subscription-hours cap set,
 * keyed by client id — clients with no cap (subscriptionHours === null)
 * are simply absent from the map, so `.get(id)` returning undefined means
 * "no budget to track," not "fully used." `renderedHours` sums the same
 * per-project `hours` (from project_hours()) that Projects > Clients and
 * the Client profile dialog already display, joined by clientId rather
 * than by name for correctness — clients.name happens to be unique too,
 * but id is the actual relationship every project already carries.
 */
export function useClientBudgets() {
  const { clients, projects } = useWorkspace();
  return useMemo(() => {
    const map = new Map<string, ClientBudgetStatus>();
    for (const c of clients) {
      if (c.subscriptionHours == null) continue;
      const renderedHours = projects
        .filter((p) => p.clientId === c.id)
        .reduce((sum, p) => sum + p.hours, 0);
      const remainingHours = c.subscriptionHours - renderedHours;
      map.set(c.id, {
        clientId: c.id,
        subscriptionHours: c.subscriptionHours,
        renderedHours,
        remainingHours,
        isOver: remainingHours <= 0,
        isNearLimit:
          remainingHours > 0 && renderedHours >= c.subscriptionHours * BUDGET_WARNING_THRESHOLD,
      });
    }
    return map;
  }, [clients, projects]);
}

export type ProjectBudgetStatus = {
  projectId: string;
  budgetHours: number;
  renderedHours: number;
  remainingHours: number;
  /** Every budgeted hour has already been used (or exceeded). */
  isOver: boolean;
  /** Not over yet, but within BUDGET_WARNING_THRESHOLD of the cap — a heads-up before it actually runs out. */
  isNearLimit: boolean;
};

/**
 * M27: same shape as useClientBudgets above, one level down — for a
 * fixed-scope/capped-hours *project* rather than an open client retainer.
 * `renderedHours` reuses the project's own all-time `hours` (already
 * computed from project_hours()), not scoped to any date range, matching
 * how the client version already treats "rendered."
 */
export function useProjectBudgets() {
  const { projects } = useWorkspace();
  return useMemo(() => {
    const map = new Map<string, ProjectBudgetStatus>();
    for (const p of projects) {
      if (p.budgetHours == null) continue;
      const remainingHours = p.budgetHours - p.hours;
      map.set(p.id, {
        projectId: p.id,
        budgetHours: p.budgetHours,
        renderedHours: p.hours,
        remainingHours,
        isOver: remainingHours <= 0,
        isNearLimit: remainingHours > 0 && p.hours >= p.budgetHours * BUDGET_WARNING_THRESHOLD,
      });
    }
    return map;
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

/** One team member's entries for one week — for Manage > Entries (H11). Gated to managers/admins; RLS further scopes a manager to people sharing a team with them. */
export function useMemberEntries(userId: string | null, weekStart: Date) {
  const { session, canManage } = useWorkspace();
  return useMemberEntriesData(!!session && canManage, userId, weekStart);
}

/** Every currently-running timer visible to this manager/admin (M18) — passive flagging, not auto-stop. */
export function useActiveTimers() {
  const { session, canManage } = useWorkspace();
  return useActiveTimersData(!!session && canManage);
}
