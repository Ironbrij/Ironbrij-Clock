import { describe, expect, it } from "vitest";
import { computeRange } from "./report-config";

// Thursday 23 October 2026.
const THURSDAY = new Date(2026, 9, 23);

describe("computeRange", () => {
  it("covers Monday to Sunday of the week before for Last week", () => {
    expect(computeRange("last_week", THURSDAY)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });

  it("still covers this Monday up to today for This week", () => {
    expect(computeRange("this_week", THURSDAY)).toEqual({ from: "2026-10-19", to: "2026-10-23" });
  });
});
