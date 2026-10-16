import { departmentFor } from "@/components/reports/report-config";
import { grossProfitForEntry, resolveInvoiceRate, type BillingRate } from "@/lib/gross-profit";
import { placementWeekFigures } from "@/lib/retainer";
import { addDays, fromDateKey, toDateKey } from "@/lib/time-utils";
import { salaryAccrualForWeek } from "@/lib/weekly-salary";
import type {
  CasualServiceCategory,
  PlacementCategory,
  WorkspaceEmployment,
  WorkspacePlacement,
  WorkspaceRevenueItem,
} from "@/lib/workspace/types";

/**
 * Reports → Weekly P&L: the accounts team's "Weekly Financial 2022 to 2026"
 * sheet, rebuilt from IronTrack's own data (decided 2026-10-16). Per
 * Monday-to-Sunday week:
 *
 *   - **Departments** — Full Time, Part Time, Casual, VIP, LMT (and
 *     Promotional, which the sheet has no row for, only when there is some).
 *     Each one's rows are client · VA · hours · pay rate · paid · invoice
 *     rate · invoiced · profit, where paid = hours × pay rate, invoiced =
 *     hours × invoice rate and profit = invoiced − paid, exactly as the sheet
 *     works them out.
 *       - Placed (external) VAs land in the department their placement's
 *         category names, on that week's entered hours (src/lib/retainer.ts).
 *       - The internal team's client work lands where `departmentFor` puts it
 *         for Gross Profit: Paid Casual → Casual, VIP Client → VIP,
 *         Promotional → Promotional, uncategorised client work → their own
 *         employment type. It's priced per entry by `grossProfitForEntry`, so
 *         Paid Casual alone is uplifted and rounded up — paid on actual hours,
 *         invoiced on billed hours (M51).
 *   - **Total profit** = Σ department profit. **Gross profit** = that +
 *     recruitment & set-up fees dated in the week (the sheet's "Recruitment
 *     and Set Up Fee"; Business Coaching isn't tracked yet).
 *   - **IB Core Team** — the internal team's internal work: headcount by
 *     employment type, hours, and wages (hourly cost plus weekly salaries).
 *     **GP after wages** = gross profit − those wages.
 *
 * Profit is invoiced − paid even when there's no invoice rate, so unpriced
 * work shows as the loss the sheet would show, and `unpriced` flags it. That
 * differs on purpose from Reports → Gross Profit, which counts unpriced work
 * as zero profit.
 */

export type WeeklyDepartmentKey =
  "full_time" | "part_time" | "casual" | "vip" | "lmt" | "promotional";

export const WEEKLY_DEPARTMENT_LABELS: Record<WeeklyDepartmentKey, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  casual: "Casual",
  vip: "VIP",
  lmt: "LMT",
  promotional: "Promotional",
};

/** The sheet's order. Promotional is IronTrack's addition and only appears when it has rows. */
const DEPARTMENT_ORDER: WeeklyDepartmentKey[] = [
  "full_time",
  "part_time",
  "casual",
  "vip",
  "lmt",
  "promotional",
];

const CATEGORY_DEPARTMENT: Record<PlacementCategory, WeeklyDepartmentKey> = {
  full_time: "full_time",
  part_time: "part_time",
  casual_external: "casual",
  vip: "vip",
  lmt: "lmt",
};

export type WeeklyDetailRow = {
  key: string;
  /** A placed VA's placement, or the internal team's time entries. */
  source: "placement" | "entry";
  clientId: string | null;
  /** placedVaId for a placement, userId for the internal team. */
  personId: string;
  /** Hours worked (units for LMT). */
  hours: number;
  /** Hours invoiced: the same as `hours` except for the internal team's Paid Casual work. */
  billedHours: number;
  /** Null when not set, or "salaried" for a salaried member, whose pay is in IB wages. */
  payRate: number | "salaried" | null;
  paid: number;
  /** Null when no invoice rate is set. */
  invoiceRate: number | null;
  invoiced: number;
  profit: number;
};

export type WeeklyDepartment = {
  key: WeeklyDepartmentKey;
  clients: number;
  vas: number;
  invoiced: number;
  paid: number;
  profit: number;
  /** Paid as a % of invoiced — what the sheet labels "GP %". Null when nothing was invoiced. */
  wagesPct: number | null;
  /** True when some of the department's work has no invoice rate. */
  unpriced: boolean;
  rows: WeeklyDetailRow[];
};

export type WeeklyFinancials = {
  weekStart: string;
  departments: WeeklyDepartment[];
  totalProfit: number;
  recruitmentFees: number;
  grossProfit: number;
  ib: { fullTime: number; partTime: number; hours: number; wages: number };
  gpAfterWages: number;
};

export type WeeklyFinancialsInput = {
  /** Monday date keys, in the order to report them. */
  weeks: string[];
  placements: WorkspacePlacement[];
  /** Hours entered for a placement's week, or null to use the contracted hours. */
  weekHours: (placementId: string, weekStart: string) => number | null;
  /** The internal team's time entries covering the weeks, each with its project's client. */
  entries: {
    userId: string;
    date: string;
    seconds: number;
    billable: boolean;
    serviceCategory: CasualServiceCategory | null;
    clientId: string | null;
  }[];
  billingRates: BillingRate[];
  employmentByUser: Map<string, WorkspaceEmployment>;
  revenueItems: WorkspaceRevenueItem[];
  incrementHours: number;
  upliftPct: number;
};

type MutableRow = Omit<WeeklyDetailRow, "key">;

export type WeeklyPnlRow = {
  label: string;
  format: "count" | "money" | "pct" | "hours";
  /** One per week, in the weeks' order. Null where there's nothing to show (a % of nothing). */
  values: (number | null)[];
  /** The sheet's bold lines: each department's profit and the totals. */
  emphasis?: boolean;
};

/**
 * The summary grid, top to bottom in the sheet's "Profit & Loss" order, with
 * a column per week. Shared by the screen and the CSV export so the two
 * can't disagree. A department shows if any of the weeks has it (only
 * Promotional can be absent).
 */
export function weeklyPnlRows(weeks: WeeklyFinancials[]): WeeklyPnlRow[] {
  const keys = DEPARTMENT_ORDER.filter((key) =>
    weeks.some((w) => w.departments.some((d) => d.key === key)),
  );
  const dept = (w: WeeklyFinancials, key: WeeklyDepartmentKey) =>
    w.departments.find((d) => d.key === key);

  const rows: WeeklyPnlRow[] = keys.flatMap((key) => {
    const label = WEEKLY_DEPARTMENT_LABELS[key];
    const values = (pick: (d: WeeklyDepartment) => number | null) =>
      weeks.map((w) => {
        const d = dept(w, key);
        return d ? pick(d) : 0;
      });
    return [
      { label: `${label} clients`, format: "count", values: values((d) => d.clients) },
      { label: `${label} invoiced`, format: "money", values: values((d) => d.invoiced) },
      { label: `${label} VAs`, format: "count", values: values((d) => d.vas) },
      { label: `${label} wages`, format: "money", values: values((d) => d.paid) },
      {
        label: `Profit for ${label}`,
        format: "money",
        values: values((d) => d.profit),
        emphasis: true,
      },
      {
        label: `${label} wages % of invoiced`,
        format: "pct",
        values: weeks.map((w) => dept(w, key)?.wagesPct ?? null),
      },
    ] satisfies WeeklyPnlRow[];
  });

  rows.push(
    {
      label: "Total profit",
      format: "money",
      values: weeks.map((w) => w.totalProfit),
      emphasis: true,
    },
    {
      label: "Recruitment & set-up fees",
      format: "money",
      values: weeks.map((w) => w.recruitmentFees),
    },
    {
      label: "Gross profit",
      format: "money",
      values: weeks.map((w) => w.grossProfit),
      emphasis: true,
    },
    { label: "IB staff – full time", format: "count", values: weeks.map((w) => w.ib.fullTime) },
    { label: "IB staff – part time", format: "count", values: weeks.map((w) => w.ib.partTime) },
    { label: "IB staff total hours", format: "hours", values: weeks.map((w) => w.ib.hours) },
    { label: "IB staff wages", format: "money", values: weeks.map((w) => w.ib.wages) },
    {
      label: "GP after wages",
      format: "money",
      values: weeks.map((w) => w.gpAfterWages),
      emphasis: true,
    },
  );
  return rows;
}

export function buildWeeklyFinancials(input: WeeklyFinancialsInput): WeeklyFinancials[] {
  return input.weeks.map((weekStart) => buildWeek(input, weekStart));
}

function buildWeek(input: WeeklyFinancialsInput, weekStart: string): WeeklyFinancials {
  const weekEnd = toDateKey(addDays(fromDateKey(weekStart), 6));
  const rowsByDepartment = new Map<WeeklyDepartmentKey, Map<string, MutableRow>>();
  const unpriced = new Set<WeeklyDepartmentKey>();

  const rowFor = (
    department: WeeklyDepartmentKey,
    key: string,
    make: () => MutableRow,
  ): MutableRow => {
    const rows = rowsByDepartment.get(department) ?? new Map<string, MutableRow>();
    rowsByDepartment.set(department, rows);
    const existing = rows.get(key);
    if (existing) return existing;
    const created = make();
    rows.set(key, created);
    return created;
  };

  // Placed VAs: one row per placement live that week, even on 0 hours, the
  // way the sheet lists a VA who didn't work.
  for (const p of input.placements) {
    const week = placementWeekFigures(p, weekStart, input.weekHours(p.id, weekStart));
    if (week.days === 0) continue;
    const department = CATEGORY_DEPARTMENT[p.category];
    const hours = week.hours ?? 0;
    const paid = week.cost ?? 0;
    const invoiced = week.revenue ?? 0;
    if (p.clientHourlyRate === null && hours > 0) unpriced.add(department);
    const row = rowFor(department, `placement:${p.id}`, () => ({
      source: "placement",
      clientId: p.clientId,
      personId: p.placedVaId,
      hours: 0,
      billedHours: 0,
      payRate: p.vaHourlyRate,
      paid: 0,
      invoiceRate: p.clientHourlyRate,
      invoiced: 0,
      profit: 0,
    }));
    row.hours += hours;
    row.billedHours += hours;
    row.paid += paid;
    row.invoiced += invoiced;
    row.profit += invoiced - paid;
  }

  // The internal team: client work into departments, internal work into IB.
  const ib = { fullTime: new Set<string>(), partTime: new Set<string>(), hours: 0, wages: 0 };
  for (const e of input.entries) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    const employment = input.employmentByUser.get(e.userId);
    const salaried = employment?.weeklySalary != null;
    const payRate = employment?.hourlyRate ?? null;
    const department = departmentFor(e, employment?.employmentType);

    if (department === "internal") {
      const hours = e.seconds / 3600;
      ib.hours += hours;
      if (!salaried && payRate !== null) ib.wages += hours * payRate;
      (employment?.employmentType === "part_time" ? ib.partTime : ib.fullTime).add(e.userId);
      continue;
    }

    const invoiceRate = e.clientId
      ? resolveInvoiceRate(input.billingRates, e.clientId, e.userId, e.date)
      : null;
    const money = grossProfitForEntry(e, {
      payRate,
      invoiceRate,
      incrementHours: input.incrementHours,
      upliftPct: input.upliftPct,
      salaried,
    });
    const weeklyDepartment: WeeklyDepartmentKey =
      department === "paid_casual"
        ? "casual"
        : department === "vip_client"
          ? "vip"
          : department === "promotional"
            ? "promotional"
            : department === "part_time"
              ? "part_time"
              : "full_time";
    if (money.revenue === null && e.billable) unpriced.add(weeklyDepartment);
    const row = rowFor(weeklyDepartment, `entry:${e.userId}:${e.clientId ?? "none"}`, () => ({
      source: "entry",
      clientId: e.clientId,
      personId: e.userId,
      hours: 0,
      billedHours: 0,
      payRate: salaried ? "salaried" : payRate,
      paid: 0,
      invoiceRate,
      invoiced: 0,
      profit: 0,
    }));
    const paid = money.cost ?? 0;
    const invoiced = money.revenue ?? 0;
    row.hours += money.actualHours;
    row.billedHours += money.billedHours;
    row.paid += paid;
    row.invoiced += invoiced;
    row.profit += invoiced - paid;
  }

  // Weekly salaries are IB wages, whatever the salaried member worked on.
  const salaryWeek = { weekStart, from: weekStart, to: weekEnd, days: 7 };
  for (const employment of input.employmentByUser.values()) {
    const accrual = salaryAccrualForWeek(employment, salaryWeek);
    if (accrual.days === 0) continue;
    ib.wages += accrual.salary;
    (employment.employmentType === "part_time" ? ib.partTime : ib.fullTime).add(employment.userId);
  }

  const departments: WeeklyDepartment[] = DEPARTMENT_ORDER.flatMap((key) => {
    const rows = [...(rowsByDepartment.get(key)?.entries() ?? [])].map(([rowKey, row]) => ({
      key: rowKey,
      ...row,
    }));
    if (key === "promotional" && rows.length === 0) return [];
    const invoiced = rows.reduce((s, r) => s + r.invoiced, 0);
    const paid = rows.reduce((s, r) => s + r.paid, 0);
    return [
      {
        key,
        clients: new Set(rows.map((r) => r.clientId ?? "none")).size,
        vas: new Set(rows.map((r) => `${r.source}:${r.personId}`)).size,
        invoiced,
        paid,
        profit: invoiced - paid,
        wagesPct: invoiced > 0 ? (paid / invoiced) * 100 : null,
        unpriced: unpriced.has(key),
        rows: rows.sort((a, b) => b.invoiced - a.invoiced || b.hours - a.hours),
      },
    ];
  });

  const totalProfit = departments.reduce((s, d) => s + d.profit, 0);
  const recruitmentFees = input.revenueItems
    .filter(
      (f) => f.kind === "recruitment_setup" && f.receivedOn >= weekStart && f.receivedOn <= weekEnd,
    )
    .reduce((s, f) => s + f.amount, 0);
  const grossProfit = totalProfit + recruitmentFees;

  return {
    weekStart,
    departments,
    totalProfit,
    recruitmentFees,
    grossProfit,
    ib: {
      fullTime: ib.fullTime.size,
      partTime: ib.partTime.size,
      hours: ib.hours,
      wages: ib.wages,
    },
    gpAfterWages: grossProfit - ib.wages,
  };
}
