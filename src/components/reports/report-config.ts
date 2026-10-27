// Report tabs' shared vocabulary — views, presets, audiences, labels — and
// the small pure helpers built on it. Split out of src/routes/reports.tsx.
import { addDays, startOfWeek, toDateKey } from "@/lib/time-utils";
import type { CasualServiceCategory, EmploymentType } from "@/lib/workspace/types";

export type ReportView = "project" | "employee" | "detailed" | "casual" | "profit" | "weekly";

/**
 * Which hour figure an export prints, for the exports that offer a choice.
 * "billed" is the Paid Casual uplift and increment applied per entry (see
 * casual-billing.ts); "actual" is the time as tracked. Only the hours change
 * — nothing else in the file is recomputed from them.
 */
export type ExportHoursBasis = "billed" | "actual";
export const reportViews: ReportView[] = [
  "project",
  "employee",
  "detailed",
  "casual",
  "profit",
  "weekly",
];
export const rangePresets: RangePreset[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_30",
  "this_quarter",
  "this_year",
  "custom",
];
export const reportAudiences: ReportAudience[] = ["all", "internal", "client"];

export type ProjectSortKey = "name" | "hours" | "billable" | "team";
export type EmployeeSortKey = "name" | "hours" | "billable" | "team" | "overtime" | "amount";
export type CasualSortKey = "group" | "entries" | "rawHours" | "billableHours" | "paid";
export type RangePreset =
  "this_week" | "last_week" | "this_month" | "last_30" | "this_quarter" | "this_year" | "custom";

export const DETAILED_PAGE_SIZE = 50;

export const presetLabels: Record<RangePreset, string> = {
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_30: "Last 30 days",
  this_quarter: "This quarter",
  this_year: "This year",
  custom: "Custom range",
};

export const casualGroupByLabels: Record<"client" | "va" | "day" | "week", string> = {
  client: "Client",
  va: "VA",
  day: "Day",
  week: "Week",
};

export type ProfitGroupBy = "va" | "client" | "team" | "service" | "employment";

export const profitGroupByLabels: Record<ProfitGroupBy, string> = {
  va: "VA",
  client: "Client",
  team: "Team",
  service: "Service line",
  employment: "Employment type",
};

/**
 * M51: the service-line split the product owner asked for — "segregate IB,
 * VIP and Casual". Every entry already carries a service_category; this is
 * the same set with a bucket for the null case, which is by far the most
 * common one (ordinary retainer and project work) and would otherwise
 * vanish from a grouped view entirely.
 *
 * Shorter than CASUAL_SERVICE_CATEGORY_LABELS on purpose: those are written
 * to disambiguate a dropdown option, these are a table's leftmost column.
 */
export const SERVICE_LINE_LABELS: Record<CasualServiceCategory | "none", string> = {
  ironbrij: "Ironbrij (internal)",
  paid_casual: "Paid Casual",
  vip_client: "VIP Client",
  promotional: "Promotional",
  none: "Retainer & other",
};

/** M51: full_time/part_time, plus the bucket for a member with no employment row yet. */
export const EMPLOYMENT_LABELS: Record<EmploymentType | "unset", string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  unset: "Employment type not set",
};

/**
 * M51: who a report is being produced for.
 *
 *   - `all` — everything, with full cost and margin. The default, and
 *     exactly what these tabs showed before M51.
 *   - `internal` — internal work only, at raw tracked hours.
 *   - `client` — client-facing work only, at billed hours, with every cost,
 *     rate, wage and margin figure removed rather than merely hidden.
 */
export type ReportAudience = "all" | "internal" | "client";

export const AUDIENCE_LABELS: Record<ReportAudience, string> = {
  all: "All work",
  internal: "Internal only",
  client: "Client-facing only",
};

/**
 * M51: what counts as internal.
 *
 * Deliberately **not** keyed on `is_billable`, which is the obvious-looking
 * choice and is wrong here. The Ironbrij project is itself flagged billable,
 * so every internal entry logged against it carries `is_billable = true` —
 * keying on that would sweep the company's own internal work straight into
 * a client-facing report. The two honest signals are the entry's service
 * category and whether it belongs to a client at all.
 */
export const isInternalWork = (e: {
  serviceCategory: CasualServiceCategory | null;
  clientId: string | null;
}) => e.serviceCategory === "ironbrij" || e.clientId === null;

/** Keeps only the rows the chosen audience should ever see. */
export function filterByAudience<
  T extends { serviceCategory: CasualServiceCategory | null; clientId: string | null },
>(rows: T[], audience: ReportAudience): T[] {
  if (audience === "all") return rows;
  const wantInternal = audience === "internal";
  return rows.filter((r) => isInternalWork(r) === wantInternal);
}

/**
 * M52: the accounts workbook's Gross Profit sheet has a *department* axis —
 * Full Time / Part Time / Casual / VIP — and neither of M51's two new
 * groupings reproduces it, because it mixes the two. A full-time VA's casual
 * work belongs to Casual on that sheet, not to Full Time, so an
 * employment-type split can never reconcile against it, and a service-line
 * split loses the full-time/part-time distinction the feedback is about.
 *
 * One bucket per entry, drawn from whichever dimension actually decides how
 * the work is priced:
 *
 *   - Ironbrij-category work, and work with no client at all, is Internal.
 *     Backup cover lives here too — confirmed as internal work rather than a
 *     category of its own.
 *   - Paid Casual, VIP Client and Promotional each get their own department,
 *     whoever did the work, because the casual programme is priced per
 *     service line rather than per employment type. Only Paid Casual is
 *     uplifted and rounded up (see casual-billing.ts).
 *   - Everything else is ordinary external-client work, split by the VA's
 *     employment type. This is the half the feedback spelled out: pay rate ×
 *     hours is what they are paid, invoice rate × hours is what the client is
 *     invoiced, and the difference is the gross profit.
 */
export type DepartmentKey =
  EmploymentType | "unset" | "paid_casual" | "vip_client" | "promotional" | "internal";

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  full_time: "Full-time (client work)",
  part_time: "Part-time (client work)",
  unset: "Employment type not set",
  paid_casual: "Paid Casual Service",
  vip_client: "VIP Client",
  promotional: "Promotional",
  internal: "Internal (incl. backup)",
};

/** Fixed presentation order — the workbook's, not whatever order the entries arrived in. */
export const DEPARTMENT_ORDER: DepartmentKey[] = [
  "full_time",
  "part_time",
  "unset",
  "paid_casual",
  "vip_client",
  "promotional",
  "internal",
];

/**
 * Which department one entry belongs to. Internal is tested first, so that
 * casual-category work logged with no client — which can't be invoiced, and
 * which `isInternalWork` already treats as internal everywhere else in this
 * tab — doesn't land in a client-facing department.
 */
export const departmentFor = (
  e: { serviceCategory: CasualServiceCategory | null; clientId: string | null },
  employmentType: EmploymentType | undefined,
): DepartmentKey => {
  if (isInternalWork(e)) return "internal";
  // The 'ironbrij' re-test is for the type checker: isInternalWork has
  // already returned for that category, but it isn't a type predicate.
  const category = e.serviceCategory;
  if (category !== null && category !== "ironbrij") return category;
  return employmentType ?? "unset";
};

// Same dimension names, phrased for the chart title ("Billable hours by
// client/VA/day/week") rather than a table column header.
export const casualGroupByChartLabels: Record<"client" | "va" | "day" | "week", string> = {
  client: "client",
  va: "VA",
  day: "day",
  week: "week",
};

// Client/VA bars past this point collapse into a single "Other" bar — a
// workspace with 60 clients would otherwise render 60 unreadable slivers.
// The table below still lists every group, so nothing is hidden outright.
export const CASUAL_CHART_MAX_BARS = 12;
// Roughly how many x-axis ticks fit legibly across the chart's width.
export const CASUAL_CHART_MAX_TICKS = 12;

// A bar gets ~60px of width; the untruncated name stays in the tooltip.
export function truncateChartLabel(label: string, max = 14) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// M38: only ever called for the fixed presets — "custom" is resolved
// directly in Reports() from the two date inputs instead, since there's
// no formula to compute it from.
export function computeRange(
  preset: Exclude<RangePreset, "custom">,
  today = new Date(),
): { from: string; to: string } {
  const to = toDateKey(today);
  switch (preset) {
    case "this_week":
      return { from: toDateKey(startOfWeek(today)), to };
    // The accounts team reads the casual figures on a Monday, about the
    // whole week before.
    case "last_week": {
      const monday = addDays(startOfWeek(today), -7);
      return { from: toDateKey(monday), to: toDateKey(addDays(monday, 6)) };
    }
    case "last_30":
      return { from: toDateKey(addDays(today, -29)), to };
    case "this_quarter": {
      const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
      return { from: toDateKey(quarterStart), to };
    }
    case "this_year":
      return { from: toDateKey(new Date(today.getFullYear(), 0, 1)), to };
    case "this_month":
    default:
      return { from: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  }
}

// H17: every value in `currencies` (workspace/types.ts) is a real ISO 4217
// code today, but this guards against a future bad value rather than
// letting Intl throw and blank the whole column.
export function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
