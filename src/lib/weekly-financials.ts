import { departmentFor } from "@/components/reports/report-config";
import {
  grossProfitForEntry,
  isChargeableEntry,
  resolveInvoiceRate,
  type BillingRate,
} from "@/lib/gross-profit";
import { payOn, salaryForRange, type PayRateRow } from "@/lib/pay-rates";
import { placementWeekFigures } from "@/lib/retainer";
import { addDays, fromDateKey, toDateKey } from "@/lib/time-utils";
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

export type WeeklyDepartmentKey = "full_time" | "part_time" | "casual" | "vip" | "lmt";

export const WEEKLY_DEPARTMENT_LABELS: Record<WeeklyDepartmentKey, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  casual: "Casual",
  vip: "VIP",
  lmt: "LMT",
};

/** The sheet's order. Promotional work is left out of the weekly P&L (decided 2026-10-30). */
const DEPARTMENT_ORDER: WeeklyDepartmentKey[] = ["full_time", "part_time", "casual", "vip", "lmt"];

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
  /** Each person's pay changes (src/lib/pay-rates.ts): entries are paid at the rate on their own day. */
  payHistoryByUser: Map<string, PayRateRow[]>;
  revenueItems: WorkspaceRevenueItem[];
  incrementHours: number;
  upliftPct: number;
};

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

/** Hours or a rate as the report shows them: to two decimals. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One line's money in whole cents, from the hours and rate exactly as shown:
 * hours to two decimals times a cent rate, rounded to the cent. Done in
 * integers so a half cent rounds up instead of whichever way binary
 * floating point lands (0.25 h × $6.06 is $1.52, not $1.51).
 */
const lineCents = (hours: number, rate: number | null) =>
  rate === null ? 0 : Math.round((Math.round(hours * 100) * Math.round(rate * 100)) / 100);

const dollars = (cents: number) => cents / 100;

/** A line while its week is being added up: exact hours, money worked out at the end. */
type OpenRow = {
  source: WeeklyDetailRow["source"];
  clientId: string | null;
  personId: string;
  hours: number;
  billedHours: number;
  payRate: WeeklyDetailRow["payRate"];
  invoiceRate: number | null;
  /** False for work that's tracked but never charged; its line invoices nothing. */
  chargeable: boolean;
};

type ClosedRow = WeeklyDetailRow & { paidCents: number; invoicedCents: number };

function closeRow(key: string, r: OpenRow): ClosedRow {
  const hours = round2(r.hours);
  const billedHours = round2(r.billedHours);
  const paidCents = typeof r.payRate === "number" ? lineCents(hours, r.payRate) : 0;
  const invoicedCents = r.chargeable ? lineCents(billedHours, r.invoiceRate) : 0;
  return {
    key,
    source: r.source,
    clientId: r.clientId,
    personId: r.personId,
    hours,
    billedHours,
    payRate: r.payRate,
    paid: dollars(paidCents),
    invoiceRate: r.invoiceRate,
    invoiced: dollars(invoicedCents),
    profit: dollars(invoicedCents - paidCents),
    paidCents,
    invoicedCents,
  };
}

function buildWeek(input: WeeklyFinancialsInput, weekStart: string): WeeklyFinancials {
  const weekEnd = toDateKey(addDays(fromDateKey(weekStart), 6));
  const rowsByDepartment = new Map<WeeklyDepartmentKey, Map<string, OpenRow>>();
  const unpriced = new Set<WeeklyDepartmentKey>();

  const rowFor = (department: WeeklyDepartmentKey, key: string, make: () => OpenRow): OpenRow => {
    const rows = rowsByDepartment.get(department) ?? new Map<string, OpenRow>();
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
    if (p.clientHourlyRate === null && hours > 0) unpriced.add(department);
    const row = rowFor(department, `placement:${p.id}`, () => ({
      source: "placement",
      clientId: p.clientId,
      personId: p.placedVaId,
      hours: 0,
      billedHours: 0,
      payRate: p.vaHourlyRate,
      invoiceRate: p.clientHourlyRate,
      chargeable: true,
    }));
    row.hours += hours;
    row.billedHours += hours;
  }

  // The internal team: client work into departments, internal work into IB.
  // Pay is whatever was in effect on the entry's own day, and a line holds
  // one pay rate and one invoice rate, so a mid-week change splits it.
  const ib = { fullTime: new Set<string>(), partTime: new Set<string>(), hours: 0 };
  /** Internal work's hours per person and pay rate: each becomes one wage line. */
  const ibWageLines = new Map<string, { hours: number; rate: number }>();
  for (const e of input.entries) {
    if (e.date < weekStart || e.date > weekEnd) continue;
    const employment = input.employmentByUser.get(e.userId);
    const pay = payOn(input.payHistoryByUser.get(e.userId) ?? [], e.date);
    const salaried = pay.weeklySalary !== null;
    const payRate = pay.hourlyRate;
    const department = departmentFor(e, employment?.employmentType);

    // Decided 2026-10-30: Promotional work isn't part of the weekly P&L.
    if (department === "promotional") continue;

    if (department === "internal") {
      const hours = e.seconds / 3600;
      ib.hours += hours;
      if (!salaried && payRate !== null) {
        const key = `${e.userId}:${payRate}`;
        const line = ibWageLines.get(key) ?? { hours: 0, rate: payRate };
        line.hours += hours;
        ibWageLines.set(key, line);
      }
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
          : department === "part_time"
            ? "part_time"
            : "full_time";
    if (money.revenue === null && e.billable) unpriced.add(weeklyDepartment);
    const chargeable = isChargeableEntry(e);
    const linePay = salaried ? "salaried" : payRate;
    const row = rowFor(
      weeklyDepartment,
      `entry:${e.userId}:${e.clientId ?? "none"}:${linePay}:${invoiceRate}:${chargeable}`,
      () => ({
        source: "entry",
        clientId: e.clientId,
        personId: e.userId,
        hours: 0,
        billedHours: 0,
        payRate: linePay,
        invoiceRate,
        chargeable,
      }),
    );
    row.hours += money.actualHours;
    row.billedHours += money.billedHours;
  }

  // IB wages: each person's internal hours at each rate, then each salary,
  // all to the cent before they're added. Salaries are IB wages whatever the
  // salaried member worked on, a day at a time at the salary then in effect.
  let ibWagesCents = 0;
  for (const line of ibWageLines.values()) ibWagesCents += lineCents(line.hours, line.rate);
  for (const [userId, history] of input.payHistoryByUser) {
    const accrual = salaryForRange(history, weekStart, weekEnd);
    if (accrual.days === 0) continue;
    ibWagesCents += Math.round(accrual.salary * 100);
    const employment = input.employmentByUser.get(userId);
    (employment?.employmentType === "part_time" ? ib.partTime : ib.fullTime).add(userId);
  }

  const departments: WeeklyDepartment[] = DEPARTMENT_ORDER.map((key) => {
    const rows = [...(rowsByDepartment.get(key)?.entries() ?? [])].map(([rowKey, row]) =>
      closeRow(rowKey, row),
    );
    const invoicedCents = rows.reduce((s, r) => s + r.invoicedCents, 0);
    const paidCents = rows.reduce((s, r) => s + r.paidCents, 0);
    return {
      key,
      clients: new Set(rows.map((r) => r.clientId ?? "none")).size,
      vas: new Set(rows.map((r) => `${r.source}:${r.personId}`)).size,
      invoiced: dollars(invoicedCents),
      paid: dollars(paidCents),
      profit: dollars(invoicedCents - paidCents),
      wagesPct: invoicedCents > 0 ? (paidCents / invoicedCents) * 100 : null,
      unpriced: unpriced.has(key),
      rows: rows
        .sort((a, b) => b.invoiced - a.invoiced || b.hours - a.hours)
        .map(({ paidCents: _paid, invoicedCents: _invoiced, ...row }) => row),
    };
  });

  const totalProfitCents = departments.reduce((s, d) => s + Math.round(d.profit * 100), 0);
  const recruitmentFeesCents = input.revenueItems
    .filter(
      (f) => f.kind === "recruitment_setup" && f.receivedOn >= weekStart && f.receivedOn <= weekEnd,
    )
    .reduce((s, f) => s + Math.round(f.amount * 100), 0);
  const grossProfitCents = totalProfitCents + recruitmentFeesCents;

  return {
    weekStart,
    departments,
    totalProfit: dollars(totalProfitCents),
    recruitmentFees: dollars(recruitmentFeesCents),
    grossProfit: dollars(grossProfitCents),
    ib: {
      fullTime: ib.fullTime.size,
      partTime: ib.partTime.size,
      hours: round2(ib.hours),
      wages: dollars(ibWagesCents),
    },
    gpAfterWages: dollars(grossProfitCents - ibWagesCents),
  };
}
