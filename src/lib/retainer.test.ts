// M49: unit coverage for the one rule that decides every retainer figure —
// how a monthly fee is spread across a reporting range, and where a
// placement's live window clips it — plus, since 2026-10-11, how an hourly
// VA rate and contracted hours become the monthly cost. Same scoped pure-function reasoning
// gross-profit.test.ts and casual-billing.test.ts already give.
import { describe, expect, it } from "vitest";
import {
  managementFee,
  placementWeekFigures,
  retainerAccrualForRange,
  vaMonthlyCost,
} from "./retainer";
import type { WorkspacePlacement } from "./workspace/types";

/** The hourly rate that makes a 40 h/week placement cost exactly `monthly` a month. */
const hourlyFor = (monthly: number, weeklyHours = 40) => (monthly * 12) / (52 * weeklyHours);

type Placement = Parameters<typeof retainerAccrualForRange>[0];
const placement = (over: Partial<Placement> = {}): Placement => ({
  startedOn: "2026-01-01",
  endedOn: null,
  // $1,000/mo VA cost, expressed the post-2026-10-11 way.
  vaHourlyRate: hourlyFor(1000),
  contractedWeeklyHours: 40,
  clientPackageAmount: 1650,
  ...over,
});

describe("retainerAccrualForRange", () => {
  it("accrues a full week at the daily rate", () => {
    // $650/mo fee -> 650 * 12 / 365 = $21.3699/day -> 7 days = $149.59.
    const r = retainerAccrualForRange(placement(), "2026-09-07", "2026-09-13");
    expect(r.days).toBe(7);
    expect(r.profit).toBeCloseTo(149.59, 2);
  });

  it("reproduces a real placement from the VA Package sheet", () => {
    // Lani Tonogbanua -> AKA Contractors: $1,000 rate, $1,650 package,
    // $650 fee. Over 30 days that's 650 * 12 / 365 * 30 = $641.10.
    const r = retainerAccrualForRange(placement(), "2026-09-01", "2026-09-30");
    expect(r.days).toBe(30);
    expect(r.cost).toBeCloseTo(986.3, 2);
    expect(r.revenue).toBeCloseTo(1627.4, 2);
    expect(r.profit).toBeCloseTo(641.1, 2);
  });

  it("counts both endpoints — a single-day range is one day, not zero", () => {
    const r = retainerAccrualForRange(placement(), "2026-09-07", "2026-09-07");
    expect(r.days).toBe(1);
  });

  it("clips to the start date for a placement that begins mid-range", () => {
    // Starts on the 5th of a 1st-10th range: the 5th through 10th is 6 days.
    const r = retainerAccrualForRange(
      placement({ startedOn: "2026-09-05" }),
      "2026-09-01",
      "2026-09-10",
    );
    expect(r.days).toBe(6);
  });

  it("clips to the end date for a placement that ends mid-range", () => {
    // Ends on the 5th of a 1st-10th range: the 1st through 5th is 5 days.
    const r = retainerAccrualForRange(
      placement({ endedOn: "2026-09-05" }),
      "2026-09-01",
      "2026-09-10",
    );
    expect(r.days).toBe(5);
  });

  it("accrues nothing for a range entirely before the placement started", () => {
    const r = retainerAccrualForRange(
      placement({ startedOn: "2026-10-01" }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r).toEqual({ days: 0, cost: 0, revenue: 0, profit: 0 });
  });

  it("accrues nothing for a range entirely after the placement ended", () => {
    const r = retainerAccrualForRange(
      placement({ endedOn: "2026-08-31" }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r).toEqual({ days: 0, cost: 0, revenue: 0, profit: 0 });
  });

  it("treats a null end date as still live, bounded only by the range", () => {
    const r = retainerAccrualForRange(placement({ endedOn: null }), "2026-09-01", "2026-09-30");
    expect(r.days).toBe(30);
  });

  it("reports a zero fee when the client has no package price (the sheet's N/A)", () => {
    // Gladys Grumo -> Jim O'Connor: $130 paid, package N/A, fee $0.00.
    const r = retainerAccrualForRange(
      placement({ vaHourlyRate: hourlyFor(130), clientPackageAmount: null }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r.cost).toBeGreaterThan(0);
    expect(r.revenue).toBe(0);
    // Not negative — an unpriced package isn't a loss, it's unknown.
    expect(r.profit).toBe(0);
  });

  it("reports a zero fee when the VA has no hourly rate", () => {
    const r = retainerAccrualForRange(
      placement({ vaHourlyRate: null, clientPackageAmount: 500 }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r.cost).toBe(0);
    expect(r.revenue).toBeGreaterThan(0);
    expect(r.profit).toBe(0);
  });

  it("counts days correctly across a daylight saving boundary", () => {
    // Australia/Sydney puts clocks forward on 2026-10-04. Local-time
    // millisecond arithmetic would lose an hour and round down to 30.
    const r = retainerAccrualForRange(placement(), "2026-10-01", "2026-10-31");
    expect(r.days).toBe(31);
  });

  it("reports a zero fee when contracted hours aren't set", () => {
    const r = retainerAccrualForRange(
      placement({ contractedWeeklyHours: null }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r.cost).toBe(0);
    expect(r.profit).toBe(0);
  });
});

describe("vaMonthlyCost", () => {
  it("is hourly rate × weekly hours × 52 ÷ 12", () => {
    // $25/h for 40 h/week: 25 * 40 * 52 / 12 = $4,333.33.
    expect(vaMonthlyCost({ vaHourlyRate: 25, contractedWeeklyHours: 40 })).toBeCloseTo(4333.33, 2);
    // Part-time: $25/h for 20 h/week is half.
    expect(vaMonthlyCost({ vaHourlyRate: 25, contractedWeeklyHours: 20 })).toBeCloseTo(2166.67, 2);
  });

  it("is unknown (null), not zero, when either side is missing", () => {
    expect(vaMonthlyCost({ vaHourlyRate: null, contractedWeeklyHours: 40 })).toBeNull();
    expect(vaMonthlyCost({ vaHourlyRate: 25, contractedWeeklyHours: null })).toBeNull();
  });

  it("keeps a converted placement's monthly cost to the cent at the stored precision", () => {
    // 20261011030000 back-calculates each existing rate at 40 h/week and
    // stores it as numeric(12,6). Rounding to six decimals must not move the
    // monthly cost by a cent, for any of the sheet's typical amounts.
    for (const monthly of [130, 650, 1000, 1234.56, 2500, 4999.99]) {
      const stored = Math.round(hourlyFor(monthly) * 1e6) / 1e6;
      const cost = vaMonthlyCost({ vaHourlyRate: stored, contractedWeeklyHours: 40 }) ?? 0;
      expect(Math.abs(cost - monthly)).toBeLessThan(0.005);
    }
  });
});

describe("placementWeekFigures", () => {
  // Monday 2026-09-07 to Sunday 2026-09-13.
  const week = "2026-09-07";

  it("is rate × contracted hours for a full week, and the package at 12 ÷ 52 of a month", () => {
    const r = placementWeekFigures(
      placement({ vaHourlyRate: 20, contractedWeeklyHours: 40, clientPackageAmount: 1650 }),
      week,
    );
    expect(r.days).toBe(7);
    // Exactly what the VA is paid for the week, not the 365-day accrual's $797.81.
    expect(r.cost).toBeCloseTo(800, 6);
    expect(r.revenue).toBeCloseTo((1650 * 12) / 52, 6);
    expect(r.fee).toBeCloseTo((1650 * 12) / 52 - 800, 6);
  });

  // 2026-10-16 (P2): external casual VAs are placements, and placements never
  // go through the Paid Casual uplift + round-up (casual-billing.ts), which
  // only ever sees the internal team's time entries. 6.1 h would bill as
  // 7.5 h under that rule; here it stays 6.1 h × rate.
  it("prices an external casual VA on plain hours × rate, with no increment", () => {
    const casual: WorkspacePlacement = {
      id: "p1",
      placedVaId: "va1",
      clientId: "c1",
      category: "casual_external",
      ...placement({ vaHourlyRate: 10, contractedWeeklyHours: 6.1 }),
    };
    const r = placementWeekFigures(casual, week);
    expect(r.cost).toBeCloseTo(61, 6);
  });

  it("pro-rates a placement that starts mid-week by the days it was live", () => {
    // Starts Friday: Friday, Saturday, Sunday.
    const r = placementWeekFigures(
      placement({ startedOn: "2026-09-11", vaHourlyRate: 20, contractedWeeklyHours: 40 }),
      week,
    );
    expect(r.days).toBe(3);
    expect(r.cost).toBeCloseTo((800 * 3) / 7, 6);
    expect(r.revenue).toBeCloseTo((((1650 * 12) / 52) * 3) / 7, 6);
  });

  it("pro-rates a placement that ends mid-week", () => {
    // Ends Tuesday: Monday and Tuesday.
    const r = placementWeekFigures(placement({ endedOn: "2026-09-08" }), week);
    expect(r.days).toBe(2);
  });

  it("is not live at all in a week before it started or after it ended", () => {
    expect(placementWeekFigures(placement({ startedOn: "2026-09-14" }), week).days).toBe(0);
    expect(placementWeekFigures(placement({ endedOn: "2026-09-06" }), week).days).toBe(0);
    expect(placementWeekFigures(placement({ endedOn: "2026-09-06" }), week)).toEqual({
      days: 0,
      cost: 0,
      revenue: 0,
      fee: 0,
    });
  });

  it("leaves an unpriced side unknown (null) and the fee at zero, not negative", () => {
    const noRate = placementWeekFigures(placement({ vaHourlyRate: null }), week);
    expect(noRate.cost).toBeNull();
    expect(noRate.revenue).toBeGreaterThan(0);
    expect(noRate.fee).toBe(0);

    const noPackage = placementWeekFigures(placement({ clientPackageAmount: null }), week);
    expect(noPackage.cost).toBeGreaterThan(0);
    expect(noPackage.revenue).toBeNull();
    expect(noPackage.fee).toBe(0);
  });

  it("counts a full week across a daylight saving change as 7 days", () => {
    // Australia/Sydney puts clocks forward on Sunday 2026-10-04.
    expect(placementWeekFigures(placement(), "2026-09-28").days).toBe(7);
  });
});

describe("managementFee", () => {
  it("is the package minus the monthly VA cost", () => {
    // Lani Tonogbanua -> AKA Contractors: $1,650 package, $1,000 VA cost.
    expect(managementFee(placement())).toBeCloseTo(650, 6);
  });

  it("is zero, not negative, when either side is unpriced", () => {
    expect(managementFee(placement({ clientPackageAmount: null }))).toBe(0);
    expect(managementFee(placement({ vaHourlyRate: null }))).toBe(0);
  });
});
