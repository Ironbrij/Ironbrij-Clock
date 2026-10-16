// Unit coverage for how a placed VA's week, month and reporting range are
// priced. Since 2026-10-16 that is hourly on both sides, the same as the
// accounts team's "Weekly Financial" sheet: paid = hours × VA rate, invoiced
// = hours × client invoice rate, and the hours are what accounts entered for
// that week (or the contracted hours when nothing was entered). Same scoped
// pure-function reasoning gross-profit.test.ts and casual-billing.test.ts give.
import { describe, expect, it } from "vitest";
import {
  clientMonthlyRevenue,
  managementFee,
  placementFiguresForRange,
  placementWeekFigures,
  vaMonthlyCost,
} from "./retainer";
import type { WorkspacePlacement } from "./workspace/types";

type Placement = Parameters<typeof placementWeekFigures>[0];
const placement = (over: Partial<Placement> = {}): Placement => ({
  startedOn: "2026-01-01",
  endedOn: null,
  vaHourlyRate: 20,
  contractedWeeklyHours: 40,
  clientHourlyRate: 30,
  ...over,
});

// Monday 2026-09-07 to Sunday 2026-09-13.
const week = "2026-09-07";

describe("placementWeekFigures", () => {
  it("is rate × contracted hours on both sides for a full week with no hours entered", () => {
    const r = placementWeekFigures(placement(), week);
    expect(r.days).toBe(7);
    expect(r.hours).toBe(40);
    expect(r.hoursEntered).toBe(false);
    expect(r.cost).toBeCloseTo(800, 6);
    expect(r.revenue).toBeCloseTo(1200, 6);
    expect(r.fee).toBeCloseTo(400, 6);
  });

  it("uses the hours entered for the week instead of contracted hours", () => {
    const r = placementWeekFigures(placement(), week, 43.5);
    expect(r.hours).toBe(43.5);
    expect(r.hoursEntered).toBe(true);
    expect(r.cost).toBeCloseTo(870, 6);
    expect(r.revenue).toBeCloseTo(1305, 6);
  });

  it("reproduces a real row from the Weekly Financial sheet", () => {
    // Oct 5-11, 2026: Ainah Ronquillo at Brefni, 43.5 h, pay $12.31, invoice
    // $14.86 -> paid $535.49, invoiced $646.41, gross profit $110.93. The
    // sheet rounds only for display: the fee is 646.41 - 535.485 = 110.925.
    const r = placementWeekFigures(
      placement({ vaHourlyRate: 12.31, clientHourlyRate: 14.86 }),
      "2026-10-05",
      43.5,
    );
    expect(r.cost).toBeCloseTo(535.485, 6);
    expect(r.revenue).toBeCloseTo(646.41, 6);
    expect(r.fee).toBeCloseTo(110.925, 6);
  });

  it("treats entered zero hours as a real zero, not as 'use contracted'", () => {
    // The sheet shows VAs on 0 hours for a week (leave, a gap between clients).
    const r = placementWeekFigures(placement(), week, 0);
    expect(r.hours).toBe(0);
    expect(r.cost).toBe(0);
    expect(r.revenue).toBe(0);
    expect(r.fee).toBe(0);
  });

  it("pro-rates contracted hours by the days live when a placement starts mid-week", () => {
    // Starts Friday: Friday, Saturday, Sunday.
    const r = placementWeekFigures(placement({ startedOn: "2026-09-11" }), week);
    expect(r.days).toBe(3);
    expect(r.hours).toBeCloseTo((40 * 3) / 7, 6);
    expect(r.cost).toBeCloseTo((800 * 3) / 7, 6);
  });

  it("does not pro-rate hours that were entered — they are that week's actual hours", () => {
    const r = placementWeekFigures(placement({ startedOn: "2026-09-11" }), week, 12);
    expect(r.days).toBe(3);
    expect(r.hours).toBe(12);
    expect(r.cost).toBeCloseTo(240, 6);
  });

  it("is not live at all in a week before it started or after it ended", () => {
    expect(placementWeekFigures(placement({ startedOn: "2026-09-14" }), week).days).toBe(0);
    expect(placementWeekFigures(placement({ endedOn: "2026-09-06" }), week, 40)).toEqual({
      days: 0,
      hours: 0,
      hoursEntered: false,
      cost: 0,
      revenue: 0,
      fee: 0,
    });
  });

  it("leaves an unpriced side unknown (null) and the fee at zero, not negative", () => {
    const noVaRate = placementWeekFigures(placement({ vaHourlyRate: null }), week);
    expect(noVaRate.cost).toBeNull();
    expect(noVaRate.revenue).toBeCloseTo(1200, 6);
    expect(noVaRate.fee).toBe(0);

    const noInvoiceRate = placementWeekFigures(placement({ clientHourlyRate: null }), week);
    expect(noInvoiceRate.cost).toBeCloseTo(800, 6);
    expect(noInvoiceRate.revenue).toBeNull();
    expect(noInvoiceRate.fee).toBe(0);
  });

  it("has nothing to price when there are neither entered nor contracted hours", () => {
    // An LMT placement is often billed per unit with no contracted hours.
    const r = placementWeekFigures(placement({ contractedWeeklyHours: null }), week);
    expect(r.hours).toBeNull();
    expect(r.cost).toBeNull();
    expect(r.revenue).toBeNull();
    expect(r.fee).toBe(0);
  });

  it("prices LMT units the same way: the sheet's $65 paid / $300 invoiced", () => {
    const r = placementWeekFigures(
      placement({ vaHourlyRate: 65, clientHourlyRate: 300, contractedWeeklyHours: null }),
      week,
      3,
    );
    expect(r.cost).toBeCloseTo(195, 6);
    expect(r.revenue).toBeCloseTo(900, 6);
    expect(r.fee).toBeCloseTo(705, 6);
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
      ...placement({ vaHourlyRate: 10, clientHourlyRate: 15 }),
    };
    const r = placementWeekFigures(casual, week, 6.1);
    expect(r.cost).toBeCloseTo(61, 6);
    expect(r.revenue).toBeCloseTo(91.5, 6);
  });

  it("counts a full week across a daylight saving change as 7 days", () => {
    // Australia/Sydney puts clocks forward on Sunday 2026-10-04.
    expect(placementWeekFigures(placement(), "2026-09-28").days).toBe(7);
  });
});

describe("placementFiguresForRange", () => {
  const noHours = () => null;

  it("adds up whole weeks", () => {
    // Two full weeks, Monday 7th to Sunday 20th.
    const r = placementFiguresForRange(placement(), "2026-09-07", "2026-09-20", noHours);
    expect(r.days).toBe(14);
    expect(r.cost).toBeCloseTo(1600, 6);
    expect(r.revenue).toBeCloseTo(2400, 6);
    expect(r.profit).toBeCloseTo(800, 6);
  });

  it("uses each week's entered hours where there are some", () => {
    const hours = (weekStart: string) => (weekStart === "2026-09-14" ? 20 : null);
    const r = placementFiguresForRange(placement(), "2026-09-07", "2026-09-20", hours);
    // 40 contracted hours the first week, 20 entered the second.
    expect(r.cost).toBeCloseTo(20 * 60, 6);
  });

  it("counts only the share of a week that falls inside the range", () => {
    // Range ends Wednesday 9th: 3 of the week's 7 live days.
    const r = placementFiguresForRange(placement(), "2026-09-07", "2026-09-09", noHours);
    expect(r.days).toBe(3);
    expect(r.cost).toBeCloseTo((800 * 3) / 7, 6);
  });

  it("splits entered hours by live days when the range cuts a week", () => {
    // 35 hours entered for a full week, range covers Mon-Wed: 3/7 of them.
    const r = placementFiguresForRange(placement(), "2026-09-07", "2026-09-09", () => 35);
    expect(r.cost).toBeCloseTo(((35 * 3) / 7) * 20, 6);
  });

  it("matches a single week exactly when the range is that week", () => {
    const one = placementWeekFigures(placement(), week, 43.5);
    const r = placementFiguresForRange(placement(), week, "2026-09-13", () => 43.5);
    expect(r.cost).toBeCloseTo(one.cost ?? 0, 6);
    expect(r.revenue).toBeCloseTo(one.revenue ?? 0, 6);
    expect(r.profit).toBeCloseTo(one.fee, 6);
  });

  it("is empty for a range entirely outside the placement", () => {
    expect(
      placementFiguresForRange(
        placement({ startedOn: "2026-10-01" }),
        "2026-09-01",
        "2026-09-30",
        noHours,
      ),
    ).toEqual({ days: 0, cost: 0, revenue: 0, profit: 0 });
  });

  it("clips to a placement that ends mid-range", () => {
    // Ends Tuesday 8th of a two-week range: 2 days live.
    const r = placementFiguresForRange(
      placement({ endedOn: "2026-09-08" }),
      "2026-09-07",
      "2026-09-20",
      noHours,
    );
    expect(r.days).toBe(2);
    expect(r.cost).toBeCloseTo((800 * 2) / 7, 6);
  });

  it("claims no profit for an unpriced placement, but still shows its known cost", () => {
    const r = placementFiguresForRange(
      placement({ clientHourlyRate: null }),
      "2026-09-07",
      "2026-09-13",
      noHours,
    );
    expect(r.cost).toBeCloseTo(800, 6);
    expect(r.revenue).toBe(0);
    expect(r.profit).toBe(0);
  });
});

describe("vaMonthlyCost and clientMonthlyRevenue", () => {
  it("are rate × weekly hours × 52 ÷ 12", () => {
    // $25/h for 40 h/week: 25 * 40 * 52 / 12 = $4,333.33.
    expect(vaMonthlyCost({ vaHourlyRate: 25, contractedWeeklyHours: 40 })).toBeCloseTo(4333.33, 2);
    expect(clientMonthlyRevenue({ clientHourlyRate: 25, contractedWeeklyHours: 20 })).toBeCloseTo(
      2166.67,
      2,
    );
  });

  it("are unknown (null), not zero, when either side is missing", () => {
    expect(vaMonthlyCost({ vaHourlyRate: null, contractedWeeklyHours: 40 })).toBeNull();
    expect(vaMonthlyCost({ vaHourlyRate: 25, contractedWeeklyHours: null })).toBeNull();
    expect(clientMonthlyRevenue({ clientHourlyRate: null, contractedWeeklyHours: 40 })).toBeNull();
  });
});

describe("managementFee", () => {
  it("is the client's monthly charge minus the VA's monthly cost", () => {
    // ($30 - $20) × 40 h × 52 ÷ 12 = $1,733.33.
    expect(managementFee(placement())).toBeCloseTo(1733.33, 2);
  });

  it("is zero, not negative, when either side is unpriced", () => {
    expect(managementFee(placement({ clientHourlyRate: null }))).toBe(0);
    expect(managementFee(placement({ vaHourlyRate: null }))).toBe(0);
  });
});
