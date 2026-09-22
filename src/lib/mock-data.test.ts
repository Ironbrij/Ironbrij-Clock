// M43: same scoped-pure-function approach as time-utils.test.ts.
import { describe, expect, it } from "vitest";
import { formatDuration, formatHours, formatMinutes } from "./mock-data";

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

describe("formatDuration", () => {
  it("reads exactly like formatMinutes when the duration lands on a whole minute", () => {
    expect(formatDuration(90 * 60)).toBe("1h 30m");
    expect(formatDuration(45 * 60)).toBe("0h 45m");
    expect(formatDuration(0)).toBe("0h 00m");
  });

  it("shows the leftover seconds when there are any (M51)", () => {
    // The case that prompted M51: this used to render as "0h 01m".
    expect(formatDuration(20)).toBe("0h 00m 20s");
    // ...and this used to be indistinguishable from a flat 3h30m.
    expect(formatDuration(3 * 3600 + 29 * 60 + 30)).toBe("3h 29m 30s");
  });

  it("pads the seconds so a column of these stays aligned", () => {
    expect(formatDuration(61)).toBe("0h 01m 01s");
  });

  it("honours an explicit seconds mode either way", () => {
    expect(formatDuration(3600, { seconds: "always" })).toBe("1h 00m 00s");
    expect(formatDuration(20, { seconds: "never" })).toBe("0h 00m");
  });

  it("rounds a fractional second rather than truncating it", () => {
    expect(formatDuration(59.6)).toBe("0h 01m");
  });

  it("clamps a negative duration to zero rather than rendering a negative clock", () => {
    expect(formatDuration(-30)).toBe("0h 00m");
  });
});
