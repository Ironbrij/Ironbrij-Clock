// Row shapes Reports() computes and the report views render. Split out of
// src/routes/reports.tsx; the field comments are the ones that sat on these
// types there.
import type {
  CasualServiceCategory,
  DetailedEntry,
  WorkspaceMember,
  WorkspacePlacement,
  WorkspaceProject,
  WorkspaceTag,
} from "@/lib/workspace/types";
import type { DepartmentKey } from "./report-config";

export type ProjectReportRow = WorkspaceProject & {
  hours: number;
  billableHours: number;
  billablePct: number | null;
  team: string;
};

export type EmployeeReportRow = WorkspaceMember & {
  hours: number;
  billableHours: number;
  billablePct: number | null;
  amount: number | null;
  overtime: number | null;
  team: string;
  teamColor: string;
};

export type DetailedReportRow = DetailedEntry & {
  hours: number;
  projectName: string;
  projectColor: string;
  employeeTeamIds: string[];
  clientId: string | null;
  /** The project's client right now; null for internal work or no project. */
  clientName: string | null;
  projectTags: WorkspaceTag[];
  employeeName: string;
  employeeInitials: string;
  employeeAvatarUrl: string | null;
};

/** One service category within a Casual Service group. */
export type CasualCategoryRow = {
  groupKey: string;
  groupLabel: string;
  tags: WorkspaceTag[];
  lastServiceDate: string | null;
  serviceCategory: CasualServiceCategory;
  entryCount: number;
  rawHours: number;
  billableHours: number;
  paidCount: number;
  tagIds: Set<string>;
};

export type CasualGroup = {
  groupKey: string;
  groupLabel: string;
  tags: WorkspaceTag[];
  lastServiceDate: string | null;
  categories: CasualCategoryRow[];
  entryCount: number;
  rawHours: number;
  billableHours: number;
  paidCount: number;
};

export type CasualChartDatum = {
  axisLabel: string;
  color: string;
  groupKey: string;
  groupLabel: string;
  hours: number;
};

export type RetainerReportRow = WorkspacePlacement & {
  vaLabel: string;
  clientLabel: string;
  days: number;
  cost: number;
  revenue: number;
  profit: number;
};

export type SalaryWeekRow = {
  weekStart: string;
  from: string;
  to: string;
  days: number;
  label: string;
  salary: number;
  headcount: number;
  hourlyProfit: number;
  net: number;
};

export type ProfitRow = {
  key: string;
  groupKey: string;
  groupLabel: string;
  clientLabel: string;
  /** M51: hours actually tracked — the basis for `cost`, and what the internal view shows. */
  actualHours: number;
  /** M51: hours invoiced — uplifted and rounded up. The basis for `revenue`. */
  billedHours: number;
  cost: number;
  revenue: number;
  profit: number;
  /** Billed hours that actually produced revenue — the denominator for a blended invoice rate. */
  ratedHours: number;
  /** Chargeable billed hours with no invoice rate on file, so the row is knowingly incomplete. */
  unpricedHours: number;
  costKnown: boolean;
  /** M50: actual hours worked by salaried staff, whose cost sits in the salary block rather than here. */
  salariedHours: number;
};

export type ProfitGroup = {
  key: string;
  label: string;
  rows: ProfitRow[];
  actualHours: number;
  billedHours: number;
  cost: number;
  revenue: number;
  profit: number;
  ratedHours: number;
  unpricedHours: number;
  costKnown: boolean;
  salariedHours: number;
};

export type DepartmentRow = {
  key: DepartmentKey | "salary";
  label: string;
  actualHours: number;
  billedHours: number;
  /** What the VAs in this department are paid — actual hours × pay rate. */
  paid: number;
  /** What the client is invoiced — billed hours × invoice rate. */
  invoice: number;
  /** Someone here has no pay rate on file, so `paid` is knowingly short. */
  hasUnpricedWork: boolean;
  /** Hours costed at zero because their owner is salaried — their pay is in the salary row. */
  salariedHours: number;
};

export type ClientFacingRow = {
  key: string;
  employeeName: string;
  clientLabel: string;
  task: string;
  /** The description the person actually typed on the entry. Empty when they left it blank. */
  description: string;
  billedHours: number;
  /** The same work as tracked, before the Paid Casual uplift and increment. Only the export reads it. */
  actualHours: number;
  /** Null when this client has no subscription allowance to draw down. */
  remainingHours: number | null;
};
