import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  members as seedMembers,
  projects as seedProjects,
  tags as seedTags,
  teams as seedTeams,
  teamMemberCount as seedTeamMemberCount,
  type Member,
  type Project,
  type Role,
} from "./mock-data";

export type Team = { id: string; name: string; color: string };

export type WorkspaceMember = Member & { pending?: boolean; email?: string };

export type WorkspaceProject = Project & {
  billable: boolean;
  tagIds: string[];
  archived: boolean;
};

export type WorkspaceSettings = {
  companyName: string;
  logoDataUrl: string | null;
  timezone: string;
  weeklyHours: number;
  currency: string;
};

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
  const clean = input.replace(/@.*$/, "").replace(/[._-]+/g, " ").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

function nameFromEmail(email: string) {
  const local = email.replace(/@.*$/, "").replace(/[._-]+/g, " ").trim();
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ") || email;
}

type WorkspaceContextValue = {
  currentUser: WorkspaceMember;
  isAdmin: boolean;
  canManage: boolean;
  setCurrentUserRole: (role: Role) => void;

  members: WorkspaceMember[];
  teams: Team[];
  projects: WorkspaceProject[];
  settings: WorkspaceSettings;

  membersByTeam: (teamId: string) => WorkspaceMember[];
  teamMemberCount: (teamId: string) => number;
  memberById: (id: string) => WorkspaceMember | undefined;

  invitePeople: (input: { emails: string[]; teamId: string; role: Role }) => number;
  updateMemberRole: (memberId: string, role: Role) => void;
  moveMember: (memberId: string, teamId: string) => void;
  removeMember: (memberId: string) => void;

  createTeam: (input: { name: string; color: string; memberIds: string[] }) => void;
  updateTeam: (teamId: string, input: { name: string; color: string }) => void;
  deleteTeam: (teamId: string) => void;

  createProject: (input: ProjectInput) => void;
  updateProject: (projectId: string, input: ProjectInput) => void;
  archiveProject: (projectId: string) => void;

  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
};

export type ProjectInput = {
  name: string;
  client: string;
  teamId: string;
  color: string;
  billable: boolean;
  tagIds: string[];
  memberIds: string[];
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<WorkspaceMember[]>(() => seedMembers.map((m) => ({ ...m })));
  const [teams, setTeams] = useState<Team[]>(() => seedTeams.map((t) => ({ ...t })));
  const [projects, setProjects] = useState<WorkspaceProject[]>(() =>
    seedProjects.map((p) => ({
      ...p,
      billable: !p.client.startsWith("Internal"),
      tagIds: p.client.startsWith("Internal") ? ["internal"] : ["billable"],
      archived: false,
    })),
  );
  const [settings, setSettings] = useState<WorkspaceSettings>({
    companyName: "Ironbrij / Virtual Assistant Australia",
    logoDataUrl: null,
    timezone: "Australia/Sydney",
    weeklyHours: 37.5,
    currency: "AUD",
  });
  const [currentRole, setCurrentRole] = useState<Role>("Admin");

  const currentUser = useMemo<WorkspaceMember>(() => {
    const me = members.find((m) => m.id === "m1") ?? members[0];
    return { ...me, role: currentRole };
  }, [members, currentRole]);

  const membersByTeam = useCallback(
    (teamId: string) => members.filter((m) => m.teamId === teamId),
    [members],
  );

  const teamMemberCount = useCallback(
    (teamId: string) => {
      const seedBase = seedMembers.filter((m) => m.teamId === teamId).length;
      const padding = Math.max(seedTeamMemberCount(teamId) - seedBase, 0);
      return membersByTeam(teamId).length + padding;
    },
    [membersByTeam],
  );

  const value = useMemo<WorkspaceContextValue>(() => {
    return {
      currentUser,
      isAdmin: currentRole === "Admin",
      canManage: currentRole === "Admin" || currentRole === "Manager",
      setCurrentUserRole: setCurrentRole,
      members,
      teams,
      projects,
      settings,
      membersByTeam,
      teamMemberCount,
      memberById: (id) => members.find((m) => m.id === id),
      invitePeople: ({ emails, teamId, role }) => {
        const fresh = emails.map<WorkspaceMember>((email) => ({
          id: nextId("m"),
          name: nameFromEmail(email),
          initials: initialsFrom(email),
          role,
          title: "Invited — awaiting sign-up",
          teamId,
          email,
          pending: true,
        }));
        setMembers((prev) => [...prev, ...fresh]);
        return fresh.length;
      },
      updateMemberRole: (memberId, role) =>
        setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m))),
      moveMember: (memberId, teamId) =>
        setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, teamId } : m))),
      removeMember: (memberId) => setMembers((prev) => prev.filter((m) => m.id !== memberId)),
      createTeam: ({ name, color, memberIds }) => {
        const id = nextId("tm");
        setTeams((prev) => [...prev, { id, name, color }]);
        if (memberIds.length) {
          setMembers((prev) =>
            prev.map((m) => (memberIds.includes(m.id) ? { ...m, teamId: id } : m)),
          );
        }
      },
      updateTeam: (teamId, input) =>
        setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, ...input } : t))),
      deleteTeam: (teamId) => setTeams((prev) => prev.filter((t) => t.id !== teamId)),
      createProject: (input) =>
        setProjects((prev) => [
          ...prev,
          { id: nextId("p"), hours: 0, archived: false, ...input },
        ]),
      updateProject: (projectId, input) =>
        setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...input } : p))),
      archiveProject: (projectId) =>
        setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, archived: true } : p))),
      updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    };
  }, [currentUser, currentRole, members, teams, projects, settings, membersByTeam, teamMemberCount]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function useWorkspaceTags() {
  return seedTags;
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
        internal: name.startsWith("Internal"),
      };
    });
  }, [projects]);
}
