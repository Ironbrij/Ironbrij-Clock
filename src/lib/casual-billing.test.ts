// M46: unit coverage for the one real, easy-to-silently-break business
// rule this feature adds — the workbook's own header comment ("Ironbrij
// is excluded from the additional increment") is exactly the kind of
// business rule worth a direct test, same reasoning time-utils.test.ts
// and mock-data.test.ts already give for their scoped pure-function
// coverage.
//
// M51: extended for the client uplift, which applies before the round-up.
import { describe, expect, it } from "vitest";
import { billableHoursForCasualEntry } from "./casual-billing";

/** The workspace defaults: round up to 0.25h, after a 20% client uplift. */
const DEFAULTS = { incrementHours: 0.25, upliftPct: 20 };
/** M46 behaviour — rounding with no uplift, for the tests that predate M51. */
const NO_UPLIFT = { incrementHours: 0.25, upliftPct: 0 };

const hours = (h: number) => ({ seconds: h * 3600 });
const minutes = (m: number) => ({ seconds: m * 60 });

describe("billableHoursForCasualEntry", () => {
  describe("scope — which entries are touched at all", () => {
    it("passes through raw hours for a non-casual entry (category null)", () => {
      expect(billableHoursForCasualEntry(minutes(100), null, DEFAULTS)).toBeCloseTo(100 / 60);
    });

    it("passes through raw hours for 'ironbrij' category, unuplifted and unrounded", () => {
      // 100 minutes = 1.6667h, which would become 2.25h under the defaults.
      expect(billableHoursForCasualEntry(minutes(100), "ironbrij", DEFAULTS)).toBeCloseTo(100 / 60);
    });

    it("applies to all three paid casual categories", () => {
      // M51 was confirmed as scoped to exactly these three — regular client
      // work is deliberately not uplifted.
      for (const category of ["paid_casual", "vip_client", "promotional"] as const) {
        expect(billableHoursForCasualEntry(minutes(100), category, NO_UPLIFT)).toBeCloseTo(1.75);
      }
    });
  });

  describe("rounding only (M46 behaviour, uplift disabled)", () => {
    it("rounds a paid casual entry up to the nearest increment", () => {
      // 100 minutes = 1.6667h -> rounds up to 1.75h at a 0.25h increment.
      expect(billableHoursForCasualEntry(minutes(100), "paid_casual", NO_UPLIFT)).toBeCloseTo(1.75);
    });

    it("leaves an already-exact increment boundary unchanged", () => {
      expect(billableHoursForCasualEntry(minutes(90), "paid_casual", NO_UPLIFT)).toBeCloseTo(1.5);
    });

    it("rounds up to a larger increment (e.g. 0.5h)", () => {
      expect(
        billableHoursForCasualEntry(minutes(100), "paid_casual", {
          incrementHours: 0.5,
          upliftPct: 0,
        }),
      ).toBeCloseTo(2.0);
    });
  });

  describe("uplift then roundoff (M51)", () => {
    it("uplifts before rounding, per the confirmed order", () => {
      // 6.10h x 1.20 = 7.32h -> rounds up to 7.50h.
      expect(billableHoursForCasualEntry(hours(6.1), "paid_casual", DEFAULTS)).toBeCloseTo(7.5);
    });

    it("differs from rounding-then-uplifting when the decimals fall that way", () => {
      // 6.30h: uplift first gives 7.56 -> 7.75. Rounding first would give
      // 6.50 -> 7.80. The order is load-bearing, not incidental.
      expect(billableHoursForCasualEntry(hours(6.3), "paid_casual", DEFAULTS)).toBeCloseTo(7.75);
    });

    it("uplifts without rounding when the increment is zero or negative", () => {
      expect(
        billableHoursForCasualEntry(hours(2), "paid_casual", { incrementHours: 0, upliftPct: 20 }),
      ).toBeCloseTo(2.4);
      expect(
        billableHoursForCasualEntry(hours(2), "paid_casual", {
          incrementHours: -0.25,
          upliftPct: 20,
        }),
      ).toBeCloseTo(2.4);
    });

    it("does not round an exact boundary up a whole step (floating point guard)", () => {
      // 100 minutes is 1.6666666666666667h; times 1.2 that is
      // 2.0000000000000004, and naive Math.ceil would bill 2.25h for work
      // that came to exactly 2.
      expect(billableHoursForCasualEntry(minutes(100), "paid_casual", DEFAULTS)).toBeCloseTo(2.0);
    });

    it("still rounds up a genuine overrun of a single second", () => {
      // The smallest real overrun must not be swallowed by that guard.
      expect(billableHoursForCasualEntry({ seconds: 2 * 3600 + 1 }, "paid_casual", NO_UPLIFT)).toBe(
        2.25,
      );
    });
  });

  describe("edges", () => {
    it("handles a zero-length entry", () => {
      expect(billableHoursForCasualEntry({ seconds: 0 }, "paid_casual", DEFAULTS)).toBe(0);
    });

    it("bills a sub-minute entry as one increment rather than nothing (M51)", () => {
      // Before M51 a 20-second entry was stored as a whole minute; now that
      // it survives as 20 seconds, the increment is what makes it billable.
      expect(billableHoursForCasualEntry({ seconds: 20 }, "paid_casual", DEFAULTS)).toBeCloseTo(
        0.25,
      );
    });
  });
});
