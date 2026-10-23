import { describe, expect, it } from "vitest";
import {
  formatTimerClock,
  runningTimerLines,
  stripTimerTitle,
  timerStoppedMessage,
  timerTabTitle,
} from "./timer-display";

describe("formatTimerClock", () => {
  it("shows hours, minutes and seconds, each padded to two digits", () => {
    expect(formatTimerClock(0)).toBe("00:00:00");
    expect(formatTimerClock(3723)).toBe("01:02:03");
  });

  it("keeps counting hours past 99 rather than wrapping", () => {
    expect(formatTimerClock(100 * 3600 + 5)).toBe("100:00:05");
  });
});

describe("timerTabTitle", () => {
  it("puts the running clock in front of the page title", () => {
    expect(timerTabTitle("Time — IronTrack", 3723, false)).toBe("▶ 01:02:03 · Time — IronTrack");
  });

  it("drops the seconds while the tab is in the background", () => {
    // Chrome only runs a background tab's timers about once a minute, so
    // seconds there would sit frozen and look like the timer had stopped.
    expect(timerTabTitle("Time — IronTrack", 3723, true)).toBe("▶ 1:02 · Time — IronTrack");
    expect(timerTabTitle("IronTrack", 59, true)).toBe("▶ 0:00 · IronTrack");
  });

  it("replaces an earlier clock instead of stacking a second one in front", () => {
    const once = timerTabTitle("IronTrack", 10, false);
    expect(timerTabTitle(once, 11, false)).toBe("▶ 00:00:11 · IronTrack");
    const hidden = timerTabTitle("IronTrack", 120, true);
    expect(timerTabTitle(hidden, 121, false)).toBe("▶ 00:02:01 · IronTrack");
  });

  it("is just the page title when no timer is running", () => {
    expect(timerTabTitle("▶ 00:00:11 · IronTrack", null, false)).toBe("IronTrack");
  });
});

describe("stripTimerTitle", () => {
  it("removes either form of the clock and leaves other titles alone", () => {
    expect(stripTimerTitle("▶ 01:02:03 · Reports — IronTrack")).toBe("Reports — IronTrack");
    expect(stripTimerTitle("▶ 12:05 · Reports — IronTrack")).toBe("Reports — IronTrack");
    expect(stripTimerTitle("Reports — IronTrack")).toBe("Reports — IronTrack");
  });
});

describe("runningTimerLines", () => {
  it("leads with the project and puts the description underneath", () => {
    expect(
      runningTimerLines({ description: "Homepage copy", task: "Copywriting" }, { name: "Acme" }),
    ).toEqual({ label: "Acme", detail: "Homepage copy" });
  });

  it("falls back to the task when there's no description", () => {
    expect(runningTimerLines({ description: "  ", task: "Copywriting" }, { name: "Acme" })).toEqual(
      { label: "Acme", detail: "Copywriting" },
    );
  });

  it("leads with the description when no project was picked", () => {
    expect(runningTimerLines({ description: "Inbox zero", task: "Admin" }, undefined)).toEqual({
      label: "Inbox zero",
      detail: "Admin",
    });
  });

  it("says No project when there's neither a project nor a description", () => {
    expect(runningTimerLines({ description: "", task: "" }, undefined)).toEqual({
      label: "No project",
      detail: null,
    });
  });
});

describe("timerStoppedMessage", () => {
  it("explains a split when the timer ran past midnight", () => {
    expect(timerStoppedMessage(true)).toMatch(/split into a separate entry for each day/);
    expect(timerStoppedMessage(false)).toBe("Entry saved to your timesheet.");
  });
});
