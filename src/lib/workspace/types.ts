// Shared types, constants, and pure (non-hook) helper functions for the
// workspace store. Split out specifically because none of this has any
// React state or side effects — moving it here is a pure relocation, not
// a behavior change, unlike the query/mutation hooks in the other
// workspace/*.ts files.

export type Role = "Admin" | "Manager" | "Member";
export type DbRole = "admin" | "manager" | "member";

export const toRole = (r: DbRole): Role =>
  r === "admin" ? "Admin" : r === "manager" ? "Manager" : "Member";
export const toDbRole = (r: Role): DbRole => r.toLowerCase() as DbRole;

export type TimesheetStatus = "Draft" | "Submitted" | "Approved" | "Rejected";
export type DbTimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export const toTimesheetStatus = (s: DbTimesheetStatus): TimesheetStatus =>
  s === "submitted"
    ? "Submitted"
    : s === "approved"
      ? "Approved"
      : s === "rejected"
        ? "Rejected"
        : "Draft";
export const toDbReviewStatus = (s: "Approved" | "Rejected"): "approved" | "rejected" =>
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
export type WorkspaceClient = {
  id: string;
  name: string;
  active: boolean;
  basecampUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  subscriptionHours: number | null;
};
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
