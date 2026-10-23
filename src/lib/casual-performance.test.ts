import { describe, expect, it } from "vitest";
import {
  casualHoursTotals,
  casualPerformanceByVa,
  formatDateSpan,
  periodChange,
  previousPeriod,
  topPaidCasualVa,
} from "./casual-performance";

type Entry = Parameters<typeof casualHoursTotals>[0][number];

// No uplift and quarter-hour rounding keeps the expected numbers readable:
// 0.4 hours of Paid Casual bills as 0.5.
const billing = { incrementHours: 0.25, upliftPct: 0 };
const HOUR = 3600;

const entry = (over: Partial<Entry> = {}): Entry => ({
  userId: "jose",
  seconds: HOUR,
  serviceCategory: "paid_casual",
  ...over,
});

describe("casualHoursTotals", () => {
  it("adds up each category, with Paid Casual after increments", () => {
    const { hours, paidCasualActual } = casualHoursTotals(
      [
        entry({ seconds: 0.4 * HOUR }),
        entry({ seconds: 0.4 * HOUR, userId: "rocky" }),
        entry({ serviceCategory: "ironbrij", seconds: 2 * HOUR }),
        entry({ serviceCategory: "vip_client", seconds: 3 * HOUR }),
        entry({ serviceCategory: "promotional", seconds: 0.5 * HOUR }),
      ],
      billing,
    );
    expect(hours).toEqual({
      paid_casual: 1,
      promotional: 0.5,
      vip_client: 3,
      ironbrij: 2,
      total: 6.5,
    });
    expect(paidCasualActual).toBeCloseTo(0.8);
  });

  it("ignores ordinary client work, which has no casual category", () => {
    const { hours } = casualHoursTotals([entry({ serviceCategory: null })], billing);
    expect(hours.total).toBe(0);
  });
});

describe("casualPerformanceByVa", () => {
  it("gives each VA a row with their hours per category", () => {
    const rows = casualPerformanceByVa(
      [
        entry({ userId: "jose", seconds: 0.4 * HOUR }),
        entry({ userId: "jose", serviceCategory: "vip_client", seconds: 2 * HOUR }),
        entry({ userId: "rocky", serviceCategory: "ironbrij", seconds: 4 * HOUR }),
      ],
      billing,
    );
    expect(rows).toEqual([
      {
        userId: "jose",
        hours: { paid_casual: 0.5, promotional: 0, vip_client: 2, ironbrij: 0, total: 2.5 },
      },
      {
        userId: "rocky",
        hours: { paid_casual: 0, promotional: 0, vip_client: 0, ironbrij: 4, total: 4 },
      },
    ]);
  });

  it("rounds Paid Casual per entry, so the VA rows add up to the overall total", () => {
    const entries = [
      entry({ userId: "jose", seconds: 0.1 * HOUR }),
      entry({ userId: "jose", seconds: 0.1 * HOUR }),
      entry({ userId: "rocky", seconds: 0.1 * HOUR }),
    ];
    const rows = casualPerformanceByVa(entries, billing);
    const sum = rows.reduce((s, r) => s + r.hours.paid_casual, 0);
    expect(sum).toBe(casualHoursTotals(entries, billing).hours.paid_casual);
    expect(sum).toBe(0.75);
  });

  it("orders VAs by Paid Casual hours, then by total", () => {
    const rows = casualPerformanceByVa(
      [
        entry({ userId: "a", serviceCategory: "ironbrij", seconds: 9 * HOUR }),
        entry({ userId: "b", seconds: 2 * HOUR }),
        entry({ userId: "c", serviceCategory: "ironbrij", seconds: 10 * HOUR }),
      ],
      billing,
    );
    expect(rows.map((r) => r.userId)).toEqual(["b", "c", "a"]);
  });
});

describe("topPaidCasualVa", () => {
  it("picks whoever has the most Paid Casual hours", () => {
    const rows = casualPerformanceByVa(
      [entry({ userId: "rocky", seconds: HOUR }), entry({ userId: "jose", seconds: 3 * HOUR })],
      billing,
    );
    expect(topPaidCasualVa(rows)?.userId).toBe("jose");
  });

  it("is null when nobody did any Paid Casual work", () => {
    const rows = casualPerformanceByVa([entry({ serviceCategory: "ironbrij" })], billing);
    expect(topPaidCasualVa(rows)).toBeNull();
  });
});

describe("previousPeriod", () => {
  it("is the week before for a Monday-to-Sunday week", () => {
    expect(previousPeriod("2026-10-12", "2026-10-18")).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("compares a week so far with the same days of last week", () => {
    expect(previousPeriod("2026-10-19", "2026-10-22")).toEqual({
      from: "2026-10-12",
      to: "2026-10-15",
    });
  });

  it("moves a longer range back in whole weeks, so weekdays still line up", () => {
    // 23 days rounds up to four weeks.
    expect(previousPeriod("2026-10-01", "2026-10-23")).toEqual({
      from: "2026-09-03",
      to: "2026-09-25",
    });
  });
});

describe("formatDateSpan", () => {
  it("names the month once when both ends share it", () => {
    expect(formatDateSpan("2026-10-12", "2026-10-18")).toBe("12 – 18 Oct");
  });

  it("names both months when the range crosses one", () => {
    expect(formatDateSpan("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct");
  });

  it("adds the years when the range crosses into a new one", () => {
    expect(formatDateSpan("2025-12-29", "2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  it("is a single date for a one-day range", () => {
    expect(formatDateSpan("2026-10-23", "2026-10-23")).toBe("23 Oct");
  });
});

describe("periodChange", () => {
  it("gives the difference and the change as a share of the earlier figure", () => {
    expect(periodChange(56.18, 85.12)).toEqual({ difference: 56.18 - 85.12, pct: -34 });
  });

  it("has no percentage when the earlier figure was zero", () => {
    expect(periodChange(2, 0)).toEqual({ difference: 2, pct: null });
    expect(periodChange(0, 0)).toEqual({ difference: 0, pct: null });
  });
});
