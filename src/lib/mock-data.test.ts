// M43: same scoped-pure-function approach as time-utils.test.ts.
import { describe, expect, it } from "vitest";
import { formatHours, formatMinutes } from "./mock-data";

describe("formatHours", () => {
  it("formats a whole number of hours", () => {
    expect(formatHours(3)).toBe("3h 00m");
  });

  it("formats a fractional number of hours, rounded to the nearest minute", () => {
    expect(formatHours(1.5)).toBe("1h 30m");
    expect(formatHours(0.25)).toBe("0h 15m");
  });

  it("formats zero", () => {
    expect(formatHours(0)).toBe("0h 00m");
  });
});

describe("formatMinutes", () => {
  it("splits minutes into hours and minutes", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("0h 45m");
    expect(formatMinutes(600)).toBe("10h 00m");
  });

  it("formats zero", () => {
    expect(formatMinutes(0)).toBe("0h 00m");
  });
});
