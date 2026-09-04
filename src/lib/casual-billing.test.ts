// M46: unit coverage for the one real, easy-to-silently-break business
// rule this feature adds — the workbook's own header comment ("Ironbrij
// is excluded from the additional increment") is exactly the kind of
// business rule worth a direct test, same reasoning time-utils.test.ts
// and mock-data.test.ts already give for their scoped pure-function
// coverage.
import { describe, expect, it } from "vitest";
import { billableHoursForCasualEntry } from "./casual-billing";

describe("billableHoursForCasualEntry", () => {
  it("passes through raw hours for a non-casual entry (category null)", () => {
    expect(billableHoursForCasualEntry({ minutes: 100 }, null, 0.25)).toBeCloseTo(100 / 60);
  });

  it("passes through raw hours for 'ironbrij' category, unrounded", () => {
    // 100 minutes = 1.6667h, which would round up to 1.75h under a 0.25 increment.
    expect(billableHoursForCasualEntry({ minutes: 100 }, "ironbrij", 0.25)).toBeCloseTo(100 / 60);
  });

  it("rounds a paid casual entry up to the nearest increment", () => {
    // 100 minutes = 1.6667h -> rounds up to 1.75h at a 0.25h increment.
    expect(billableHoursForCasualEntry({ minutes: 100 }, "paid_casual", 0.25)).toBeCloseTo(1.75);
  });

  it("rounds vip_client and promotional entries the same as paid_casual", () => {
    expect(billableHoursForCasualEntry({ minutes: 100 }, "vip_client", 0.25)).toBeCloseTo(1.75);
    expect(billableHoursForCasualEntry({ minutes: 100 }, "promotional", 0.25)).toBeCloseTo(1.75);
  });

  it("leaves an already-exact increment boundary unchanged", () => {
    // 90 minutes = 1.5h, already an exact multiple of 0.25.
    expect(billableHoursForCasualEntry({ minutes: 90 }, "paid_casual", 0.25)).toBeCloseTo(1.5);
  });

  it("rounds up to a larger increment (e.g. 0.5h)", () => {
    // 100 minutes = 1.6667h -> rounds up to 2.0h at a 0.5h increment.
    expect(billableHoursForCasualEntry({ minutes: 100 }, "paid_casual", 0.5)).toBeCloseTo(2.0);
  });

  it("falls back to raw hours when the increment is zero or negative", () => {
    expect(billableHoursForCasualEntry({ minutes: 100 }, "paid_casual", 0)).toBeCloseTo(100 / 60);
    expect(billableHoursForCasualEntry({ minutes: 100 }, "paid_casual", -0.25)).toBeCloseTo(
      100 / 60,
    );
  });

  it("handles zero minutes", () => {
    expect(billableHoursForCasualEntry({ minutes: 0 }, "paid_casual", 0.25)).toBe(0);
  });
});
