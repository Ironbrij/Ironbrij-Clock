// The weekly P&L (Reports → Weekly P&L), checked against the accounts
// team's "Weekly Financial 2022 to 2026" sheet — the report it replaces.
import { describe, expect, it } from "vitest";
import {
  buildWeeklyFinancials,
  weeklyPnlRows,
  type WeeklyFinancialsInput,
} from "./weekly-financials";
import { PAY_FROM_THE_START, groupPayHistory, payHistoryFromEmployment } from "./pay-rates";
import type { WorkspaceEmployment, WorkspacePlacement } from "./workspace/types";

const WEEK = "2026-09-28"; // Mon 28 Sep – Sun 4 Oct 2026

let nextId = 0;
const placement = (over: Partial<WorkspacePlacement>): WorkspacePlacement => ({
  id: `p${++nextId}`,
  placedVaId: `va${nextId}`,
  clientId: "client",
  startedOn: "2026-01-01",
  endedOn: null,
  vaHourlyRate: 10,
  contractedWeeklyHours: 40,
  clientHourlyRate: 15,
  category: "full_time",
  ...over,
});

const employment = (
  userId: string,
  over: Partial<WorkspaceEmployment> = {},
): WorkspaceEmployment => ({
  userId,
  employmentType: "full_time",
  staffType: "internal",
  hourlyRate: 6,
  weeklySchedule: null,
  weeklyScheduleDays: null,
  weeklySalary: null,
  salaryFrom: null,
  salaryTo: null,
  ...over,
});

const entry = (over: Partial<WeeklyFinancialsInput["entries"][number]>) => ({
  userId: "staff",
  date: "2026-09-30",
  seconds: 3600,
  billable: true,
  serviceCategory: null,
  clientId: null,
  ...over,
});

// Pay history comes from the fixtures' employment, by the same rules the
// member_pay_rates migration seeded with, unless a test gives its own.
const input = (over: Partial<WeeklyFinancialsInput>): WeeklyFinancialsInput => {
  const employmentByUser = over.employmentByUser ?? new Map<string, WorkspaceEmployment>();
  return {
    weeks: [WEEK],
    placements: [],
    weekHours: () => null,
    entries: [],
    billingRates: [],
    employmentByUser,
    payHistoryByUser: groupPayHistory(
      [...employmentByUser.values()].flatMap((e) => payHistoryFromEmployment(e)),
    ),
    revenueItems: [],
    incrementHours: 0.25,
    upliftPct: 20,
    ...over,
  };
};

const department = (week: ReturnType<typeof buildWeeklyFinancials>[number], key: string) => {
  const d = week.departments.find((x) => x.key === key);
  if (!d) throw new Error(`no ${key} department`);
  return d;
};

describe("buildWeeklyFinancials — the sheet's Full Time block, 28 Sep – 4 Oct 2026", () => {
  // [client, VA, hours, pay rate, invoice rate], copied from the sheet.
  const rows: [string, string, number, number, number][] = [
    ["Brefni", "Ainah Ronquillo", 40, 12.31, 14.86],
    ["TNT Creative Trust trading", "Arnelyn Redoble", 40, 5.77, 9.52],
    ["Brefni", "Cyrille Ritos", 45, 9.44, 13.82],
    ["Brefni", "Jonathan Laniog", 40, 13.63, 17.57],
    ["Brefni", "Juenna Marece Garcia", 40, 8.65, 13.78],
    ["Andrew Colsky", "King Marco Bilingan", 40, 7.21, 12.68],
    ["AKA Civil", "Lani Tonogbanua", 40, 5.75, 9.52],
    ["Coplex Construction Pty Ltd", "Ma. Cherry Flores", 40, 7.93, 11.68],
    ["Coplex Contraction Pty Ltd", "Mavelle Cudiamat", 40, 6.92, 10.67],
    ["Brefni", "Michelle Grace Joves", 42, 10.77, 15.5],
    ["Simon Deduhin", "Ragini Ann David- Yu", 40, 9.52, 13.27],
  ];
  const placements = rows.map(([client, va, , pay, invoice]) =>
    placement({ clientId: client, placedVaId: va, vaHourlyRate: pay, clientHourlyRate: invoice }),
  );
  const hours = new Map(placements.map((p, i) => [p.id, rows[i][2]]));
  const [week] = buildWeeklyFinancials(
    input({ placements, weekHours: (id) => hours.get(id) ?? null }),
  );
  const ft = department(week, "full_time");

  it("invoices $5,814.90 and pays $3,984.74, for $1,830.16 gross", () => {
    expect(ft.invoiced).toBeCloseTo(5814.9, 2);
    expect(ft.paid).toBeCloseTo(3984.74, 2);
    expect(ft.profit).toBeCloseTo(1830.16, 2);
  });

  it("counts 7 clients and 11 VAs", () => {
    expect(ft.clients).toBe(7);
    expect(ft.vas).toBe(11);
  });

  it("reports the sheet's 'GP %' as what it really is: wages as a share of invoiced", () => {
    expect(ft.wagesPct).toBeCloseTo((3984.74 / 5814.9) * 100, 2);
  });

  it("has one detail row per VA and client, at the sheet's figures", () => {
    const ainah = ft.rows.find((r) => r.personId === "Ainah Ronquillo")!;
    expect(ainah.hours).toBe(40);
    expect(ainah.paid).toBeCloseTo(492.4, 2);
    expect(ainah.invoiced).toBeCloseTo(594.4, 2);
    expect(ainah.profit).toBeCloseTo(102, 2);
  });
});

describe("buildWeeklyFinancials — departments and totals", () => {
  it("puts each placement in the department its category names", () => {
    const [week] = buildWeeklyFinancials(
      input({
        placements: [
          placement({ category: "part_time" }),
          placement({ category: "casual_external" }),
          placement({ category: "vip" }),
          placement({
            category: "lmt",
            vaHourlyRate: 65,
            clientHourlyRate: 300,
            contractedWeeklyHours: null,
          }),
        ],
        weekHours: () => 1,
      }),
    );
    expect(department(week, "part_time").invoiced).toBeCloseTo(15, 6);
    expect(department(week, "casual").invoiced).toBeCloseTo(15, 6);
    expect(department(week, "vip").invoiced).toBeCloseTo(15, 6);
    expect(department(week, "lmt").invoiced).toBeCloseTo(300, 6);
    expect(department(week, "lmt").paid).toBeCloseTo(65, 6);
    expect(department(week, "full_time").invoiced).toBe(0);
  });

  it("adds the internal team's Paid Casual time to Casual, with the increment", () => {
    // 6.1 h tracked: paid on actual hours, invoiced on 6.1 × 1.2 = 7.32 → 7.5 h.
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ serviceCategory: "paid_casual", clientId: "kim", seconds: 6.1 * 3600 })],
        billingRates: [
          { clientId: "kim", userId: null, hourlyRate: 15, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    const casual = department(week, "casual");
    expect(casual.paid).toBeCloseTo(36.6, 6);
    expect(casual.invoiced).toBeCloseTo(112.5, 6);
    expect(casual.rows[0].billedHours).toBeCloseTo(7.5, 6);
    expect(casual.rows[0].source).toBe("entry");
  });

  it("never applies the increment to an external casual VA (a placement)", () => {
    const [week] = buildWeeklyFinancials(
      input({ placements: [placement({ category: "casual_external" })], weekHours: () => 6.1 }),
    );
    const casual = department(week, "casual");
    expect(casual.rows[0].billedHours).toBeCloseTo(6.1, 6);
    expect(casual.invoiced).toBeCloseTo(91.5, 6);
  });

  it("puts the internal team's VIP time under VIP", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ serviceCategory: "vip_client", clientId: "myra" })],
        billingRates: [
          { clientId: "myra", userId: null, hourlyRate: 20, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    expect(department(week, "vip").invoiced).toBeCloseTo(20, 6);
  });

  it("leaves Promotional work out of the report entirely", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ serviceCategory: "promotional", clientId: "promo" })],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    expect(week.departments.map((d) => d.key as string)).not.toContain("promotional");
    expect(week.departments.every((d) => d.paid === 0)).toBe(true);
    expect(week.totalProfit).toBe(0);
    expect(weeklyPnlRows([week]).some((r) => r.label.includes("Promotional"))).toBe(false);
  });

  it("counts internal work as IB Core Team wages and hours, not as a department", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [
          entry({ userId: "a", serviceCategory: "ironbrij", seconds: 40 * 3600 }),
          entry({ userId: "b", clientId: null, seconds: 20 * 3600 }),
        ],
        employmentByUser: new Map([
          ["a", employment("a", { hourlyRate: 7 })],
          ["b", employment("b", { employmentType: "part_time", hourlyRate: 6.24 })],
        ]),
      }),
    );
    expect(week.ib.hours).toBeCloseTo(60, 6);
    expect(week.ib.wages).toBeCloseTo(40 * 7 + 20 * 6.24, 6);
    expect(week.ib.fullTime).toBe(1);
    expect(week.ib.partTime).toBe(1);
    expect(week.departments.every((d) => d.paid === 0)).toBe(true);
  });

  it("charges a salaried member's weekly salary to IB wages, and none of their entries", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ userId: "s", serviceCategory: "paid_casual", clientId: "kim" })],
        billingRates: [
          { clientId: "kim", userId: null, hourlyRate: 15, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([
          ["s", employment("s", { weeklySalary: 300, salaryFrom: "2026-01-01" })],
        ]),
      }),
    );
    expect(department(week, "casual").paid).toBe(0);
    expect(week.ib.wages).toBeCloseTo(300, 6);
  });

  it("is Gross Profit = department profit + recruitment fees, and GP after wages takes off IB wages", () => {
    // Week 1 of 2026 in the sheet: 5,504.54 + 227.15 = 5,731.69.
    const [week] = buildWeeklyFinancials(
      input({
        placements: [placement({ vaHourlyRate: 10, clientHourlyRate: 15 })],
        weekHours: () => 40,
        revenueItems: [
          {
            id: "f1",
            receivedOn: "2026-10-01",
            clientId: null,
            kind: "recruitment_setup",
            amount: 227.15,
            note: null,
          },
          {
            id: "f2",
            receivedOn: "2026-10-05",
            clientId: null,
            kind: "recruitment_setup",
            amount: 999,
            note: null,
          },
        ],
        entries: [entry({ serviceCategory: "ironbrij", seconds: 10 * 3600 })],
        employmentByUser: new Map([["staff", employment("staff", { hourlyRate: 5 })]]),
      }),
    );
    expect(week.totalProfit).toBeCloseTo(200, 6);
    // The 5 Oct fee belongs to the next week.
    expect(week.recruitmentFees).toBeCloseTo(227.15, 6);
    expect(week.grossProfit).toBeCloseTo(427.15, 6);
    expect(week.gpAfterWages).toBeCloseTo(427.15 - 50, 6);
  });

  it("counts a live placement on zero hours as a client and VA, like the sheet's 0-hour rows", () => {
    const [week] = buildWeeklyFinancials(
      input({ placements: [placement({})], weekHours: () => 0 }),
    );
    const ft = department(week, "full_time");
    expect(ft.clients).toBe(1);
    expect(ft.vas).toBe(1);
    expect(ft.invoiced).toBe(0);
  });

  it("leaves out a placement that wasn't live that week, and entries from other weeks", () => {
    const [week] = buildWeeklyFinancials(
      input({
        placements: [placement({ endedOn: "2026-09-20" })],
        entries: [entry({ serviceCategory: "ironbrij", date: "2026-10-05" })],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    expect(department(week, "full_time").clients).toBe(0);
    expect(week.ib.hours).toBe(0);
  });

  it("shows work with no invoice rate as a loss, the sheet's invoiced − paid", () => {
    const [week] = buildWeeklyFinancials(
      input({ placements: [placement({ clientHourlyRate: null })], weekHours: () => 10 }),
    );
    const ft = department(week, "full_time");
    expect(ft.paid).toBeCloseTo(100, 6);
    expect(ft.invoiced).toBe(0);
    expect(ft.profit).toBeCloseTo(-100, 6);
    expect(ft.unpriced).toBe(true);
  });

  it("returns one result per week, in order", () => {
    const weeks = buildWeeklyFinancials(input({ weeks: ["2026-09-28", "2026-10-05"] }));
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-09-28", "2026-10-05"]);
  });
});

describe("buildWeeklyFinancials — every line checks with a calculator (19–25 Oct 2026 export)", () => {
  it("prices a placement at its cent rates: 40 h × $7.93 = $317.20", () => {
    const [week] = buildWeeklyFinancials(
      input({
        placements: [placement({ vaHourlyRate: 7.93, clientHourlyRate: 11.68 })],
        weekHours: () => 40,
      }),
    );
    const row = department(week, "full_time").rows[0];
    expect(row.paid).toBe(317.2);
    expect(row.invoiced).toBe(467.2);
    expect(row.profit).toBe(150);
  });

  it("works a line out from the hours it shows: 9.13 h × $6.00 = $54.78", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ serviceCategory: "vip_client", clientId: "myra", seconds: 32856 })],
        billingRates: [
          { clientId: "myra", userId: null, hourlyRate: 10, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    const row = department(week, "vip").rows[0];
    expect(row.hours).toBe(9.13);
    expect(row.paid).toBe(54.78);
    expect(row.invoiced).toBe(91.3);
  });

  it("makes each department's totals the sum of its lines, to the cent", () => {
    const placements = [
      placement({ category: "casual_external", vaHourlyRate: 6, clientHourlyRate: 15.6 }),
      placement({ category: "casual_external", vaHourlyRate: 8.08, clientHourlyRate: 15.6 }),
      placement({ category: "casual_external", vaHourlyRate: 6, clientHourlyRate: 10 }),
    ];
    const hours = new Map([
      [placements[0].id, 4.2617],
      [placements[1].id, 0.3233],
      [placements[2].id, 9.1267],
    ]);
    const [week] = buildWeeklyFinancials(
      input({ placements, weekHours: (id) => hours.get(id) ?? null }),
    );
    const casual = department(week, "casual");
    expect(casual.rows.map((r) => [r.hours, r.paid, r.invoiced])).toEqual([
      [9.13, 54.78, 91.3],
      [4.26, 25.56, 66.46],
      [0.32, 2.59, 4.99],
    ]);
    expect(casual.paid).toBe(82.93);
    expect(casual.invoiced).toBe(162.75);
    expect(casual.profit).toBe(79.82);
    expect(week.totalProfit).toBe(79.82);
  });

  it("splits a VA's line when their pay changes mid-week", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [
          entry({ serviceCategory: "vip_client", clientId: "myra", date: "2026-09-28" }),
          entry({ serviceCategory: "vip_client", clientId: "myra", date: "2026-10-01" }),
        ],
        billingRates: [
          { clientId: "myra", userId: null, hourlyRate: 10, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([["staff", employment("staff")]]),
        payHistoryByUser: groupPayHistory([
          { userId: "staff", effectiveFrom: PAY_FROM_THE_START, hourlyRate: 6, weeklySalary: null },
          { userId: "staff", effectiveFrom: "2026-10-01", hourlyRate: 6.5, weeklySalary: null },
        ]),
      }),
    );
    const vip = department(week, "vip");
    expect(vip.rows.map((r) => r.payRate).sort()).toEqual([6, 6.5]);
    expect(vip.paid).toBe(12.5);
  });

  it("keeps billable and non-billable work on separate lines, so each checks", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [
          entry({ serviceCategory: "vip_client", clientId: "myra" }),
          entry({ serviceCategory: "vip_client", clientId: "myra", billable: false }),
        ],
        billingRates: [
          { clientId: "myra", userId: null, hourlyRate: 10, effectiveFrom: "2026-01-01" },
        ],
        employmentByUser: new Map([["staff", employment("staff")]]),
      }),
    );
    const rows = department(week, "vip").rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.invoiced).sort()).toEqual([0, 10]);
  });

  it("rounds each IB wage line to the cent: 2.33 h × $6 + a $700 salary", () => {
    const [week] = buildWeeklyFinancials(
      input({
        entries: [entry({ serviceCategory: "ironbrij", seconds: 8400 })],
        employmentByUser: new Map([
          ["staff", employment("staff")],
          ["s", employment("s", { weeklySalary: 700, salaryFrom: "2026-01-01" })],
        ]),
      }),
    );
    expect(week.ib.hours).toBe(2.33);
    expect(week.ib.wages).toBe(713.98);
  });
});

describe("weeklyPnlRows", () => {
  it("lays the summary out in the sheet's order, ending with GP after wages", () => {
    const weeks = buildWeeklyFinancials(input({ weeks: ["2026-09-28", "2026-10-05"] }));
    const labels = weeklyPnlRows(weeks).map((r) => r.label);
    expect(labels.slice(0, 6)).toEqual([
      "Full Time clients",
      "Full Time invoiced",
      "Full Time VAs",
      "Full Time wages",
      "Profit for Full Time",
      "Full Time wages % of invoiced",
    ]);
    expect(labels.slice(-3)).toEqual(["IB staff total hours", "IB staff wages", "GP after wages"]);
    expect(labels.some((l) => l.includes("Promotional"))).toBe(false);
    expect(weeklyPnlRows(weeks).every((r) => r.values.length === 2)).toBe(true);
  });
});
