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

/** M46: Casual Service Monitoring category — null (the far-more-common case) means "not a casual-monitoring entry at all," distinct from 'ironbrij' (tracked casual work, just unbilled). See docs/audit-findings.md M46. */
export type CasualServiceCategory = "ironbrij" | "paid_casual" | "vip_client" | "promotional";

export const CASUAL_SERVICE_CATEGORY_LABELS: Record<CasualServiceCategory, string> = {
  ironbrij: "Ironbrij (internal, no charge)",
  paid_casual: "Paid Casual Service",
  vip_client: "VIP Client",
  promotional: "Promotional",
};

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
  /** L31: null until someone uploads one — every Avatar render falls back to initials via AvatarFallback until then. */
  avatarUrl: string | null;
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
  /** M25: empty means unrestricted — every task category is offered, today's exact default behavior. Non-empty scopes the task picker to just these. */
  taskCategoryIds: string[];
  billable: boolean;
  archived: boolean;
  /** M27: optional cap on logged hours, for a fixed-scope/capped project — null means no budget set. All-time, same as `hours`, not scoped to any date range. */
  budgetHours: number | null;
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
/** The editable half of a client — everything but the name and active flag. Shared by createClient and updateClientProfile so the add and edit forms stay in step. */
export type WorkspaceClientProfile = Omit<WorkspaceClient, "id" | "name" | "active">;
import type { WeeklyScheduleDays } from "@/lib/time-utils";

export type EmploymentType = "full_time" | "part_time";
export type { DaySchedule, WeeklyScheduleDays } from "@/lib/time-utils";
export type WorkspaceEmployment = {
  userId: string;
  employmentType: EmploymentType;
  hourlyRate: number | null;
  /** Legacy single free-text note — superseded by weeklyScheduleDays, kept only as a fallback to seed it. */
  weeklySchedule: string | null;
  weeklyScheduleDays: WeeklyScheduleDays | null;
  /** M50: a non-null salary is what makes a member salaried — their cost is this flat weekly figure rather than hours x hourlyRate. */
  weeklySalary: number | null;
  /** First day weeklySalary applies. Always set when weeklySalary is. */
  salaryFrom: string | null;
  /** Last day weeklySalary applies; null means still employed. */
  salaryTo: string | null;
};

/**
 * M48: one effective-dated invoice rate — what a client is charged per hour.
 * `userId` null is the client's default; a non-null `userId` is a per-VA
 * override for that client, which wins over the default.
 */
export type WorkspaceBillingRate = {
  id: string;
  clientId: string;
  userId: string | null;
  hourlyRate: number;
  /** Date key (YYYY-MM-DD) this rate starts applying from. */
  effectiveFrom: string;
};

/** The editable half of a billing rate — what the add form collects. */
export type WorkspaceBillingRateInput = Omit<WorkspaceBillingRate, "id">;

/** M49: a VA placed with a client on a monthly retainer. Not an IronTrack user — placed VAs log no time here. */
export type WorkspacePlacedVA = { id: string; fullName: string };

/**
 * M49: one VA↔client retainer placement. `endedOn` null means still live —
 * that's the status, and it also bounds the daily accrual in
 * src/lib/retainer.ts. Both amounts are null for the sheet's "N/A" rows.
 * The management fee is derived (package − rate, or 0), never stored.
 */
export type WorkspacePlacement = {
  id: string;
  placedVaId: string;
  clientId: string;
  startedOn: string;
  endedOn: string | null;
  vaMonthlyRate: number | null;
  clientPackageAmount: number | null;
};

/** The editable half of a placement — what the add/edit form collects. */
export type WorkspacePlacementInput = Omit<WorkspacePlacement, "id" | "placedVaId"> & {
  /** An existing placed VA's id, or a new name to create one from. */
  placedVaId?: string;
  placedVaName?: string;
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
  /** M46: casual-billing rounding increment (hours) — see src/lib/casual-billing.ts. */
  casualBillingIncrementHours: number;
  /** M46: days since a client's last casual-service entry before useClientHealth flags it inactive. */
  clientInactiveThresholdDays: number;
};

export type WorkspaceEntry = {
  id: string;
  projectId: string | null;
  task: string;
  description: string;
  minutes: number;
  /** M51: the real tracked duration. `minutes` is this rounded, kept for callers that still work in whole minutes — prefer this one for anything that displays or prices the entry. */
  seconds: number;
  startTime: string;
  endTime: string | null;
  date: string;
  running: boolean;
  /** M26: per-entry override, independent of the project's own default — set at creation from the project's billable flag, but editable afterward. */
  billable: boolean;
  /** M46: null means not a Casual Service Monitoring entry at all. */
  serviceCategory: CasualServiceCategory | null;
  /** M46: accounts-team-set date the VA was paid for this line — null until then. Admin-only write, via markCasualEntriesPaid — never settable through updateEntry. */
  vaPaidAt: string | null;
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
  /** M23: set server-side whenever an admin edits/deletes an entry inside this week after it was already approved — surfaced so the stale total isn't mistaken for the one that was actually signed off. */
  entriesModifiedAt: string | null;
};

/** A submitted timesheet plus the hours it covers, for a manager/admin's review queue. */
export type PendingApproval = WorkspaceTimesheet & { seconds: number };

/** One line item behind a PendingApproval's total — lets a reviewer see what they're actually approving instead of just a sum. */
export type PendingApprovalEntry = {
  id: string;
  projectId: string | null;
  task: string;
  description: string;
  seconds: number;
  startTime: string;
};

/** H16: one raw entry, scoped by time_entries' own RLS — backs the Reports page's Detailed tab. */
export type DetailedEntry = {
  id: string;
  userId: string;
  projectId: string | null;
  task: string;
  description: string;
  date: string;
  minutes: number;
  /** M51: see WorkspaceEntry.seconds. This is the figure the Gross Profit tab prices — rounding to the minute first is what M51 set out to stop. */
  seconds: number;
  billable: boolean;
  startTime: string;
  /** M51 (W6): tags copied onto the entry when it was logged, per `time_entries.tag_ids`. */
  tagIds: string[];
  /** M46: null means not a Casual Service Monitoring entry at all. */
  serviceCategory: CasualServiceCategory | null;
  /** M46: accounts-team-set date the VA was paid for this line — null until then. */
  vaPaidAt: string | null;
};

/** One posted announcement — `teamIds` is empty for an 'everyone' post, non-empty for a team-scoped one. */
export type WorkspaceAnnouncement = {
  id: string;
  authorId: string;
  title: string;
  body: string;
  audience: "everyone" | "teams";
  teamIds: string[];
  createdAt: string;
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
  /** M25: empty means unrestricted — see WorkspaceProject.taskCategoryIds. */
  taskCategoryIds: string[];
  /** M27: null clears/omits the budget. */
  budgetHours: number | null;
};
