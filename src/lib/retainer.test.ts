// M49: unit coverage for the one rule that decides every retainer figure —
// how a monthly fee is spread across a reporting range, and where a
// placement's live window clips it. Same scoped pure-function reasoning
// gross-profit.test.ts and casual-billing.test.ts already give.
import { describe, expect, it } from "vitest";
import { retainerAccrualForRange } from "./retainer";

const placement = (over: Partial<Parameters<typeof retainerAccrualForRange>[0]> = {}) => ({
  startedOn: "2026-01-01",
  endedOn: null,
  vaMonthlyRate: 1000,
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
      placement({ vaMonthlyRate: 130, clientPackageAmount: null }),
      "2026-09-01",
      "2026-09-30",
    );
    expect(r.cost).toBeGreaterThan(0);
    expect(r.revenue).toBe(0);
    // Not negative — an unpriced package isn't a loss, it's unknown.
    expect(r.profit).toBe(0);
  });

  it("reports a zero fee when the VA has no monthly rate", () => {
    const r = retainerAccrualForRange(
      placement({ vaMonthlyRate: null, clientPackageAmount: 500 }),
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
});
