// M43: a scoped starting point, not full coverage — unit tests for the
// pure date/time logic in this file that doesn't need a database, picked
// because it's exactly the kind of subtle, easy-to-silently-break code
// this document's own audits have already found real bugs in once
// (H18's dry-run summary used the wrong timezone conversion path) and
// depend on for several historical fixes (H8/M21's day-splitting, H16's
// week boundaries). Doesn't touch the SECURITY DEFINER functions the
// audit's own M43 finding names as the highest-value target — those need
// a live Postgres instance this environment doesn't have.
import { describe, expect, it } from "vitest";
import {
  addDays,
  combineDateAndTime,
  composeWeeklySchedule,
  convertTimeRange,
  dayIndexOf,
  expandWeeklyScheduleToDays,
  fromDateKey,
  isEmptyWeeklyScheduleDays,
  oldestLoadedWeekStart,
  orderByRecency,
  orderByRecencyName,
  parseWeeklySchedule,
  splitByDay,
  startOfWeek,
  summarizeWeeklyScheduleDays,
  toDateKey,
} from "./time-utils";

describe("startOfWeek", () => {
  it("returns the same Monday for every day in that week", () => {
    const monday = new Date(2026, 7, 24); // 2026-08-24 is a Monday
    for (let i = 0; i < 7; i++) {
      expect(toDateKey(startOfWeek(addDays(monday, i)))).toBe("2026-08-24");
    }
  });

  it("zeroes out the time of day", () => {
    const d = new Date(2026, 7, 26, 23, 59, 59, 999);
    const start = startOfWeek(d);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe("toDateKey / fromDateKey", () => {
  it("round-trips a date through both directions", () => {
    const key = "2026-01-05";
    expect(toDateKey(fromDateKey(key))).toBe(key);
  });

  it("pads single-digit months and days", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("oldestLoadedWeekStart", () => {
  it("is a Monday", () => {
    const start = oldestLoadedWeekStart();
    expect(start.getDay()).toBe(1);
  });

  it("is roughly ENTRIES_HISTORY_DAYS in the past", () => {
    const start = oldestLoadedWeekStart();
    const daysAgo = (Date.now() - start.getTime()) / 86_400_000;
    // Within a week of 400 days — startOfWeek's own rounding to Monday
    // accounts for the rest.
    expect(daysAgo).toBeGreaterThan(393);
    expect(daysAgo).toBeLessThan(407);
  });
});

describe("splitByDay", () => {
  it("returns a single segment for a span that never crosses midnight", () => {
    const start = new Date(2026, 7, 24, 9, 0);
    const end = new Date(2026, 7, 24, 17, 30);
    const segments = splitByDay(start, end);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ date: "2026-08-24", minutes: 510 });
  });

  it("splits an overnight shift at local midnight (H8)", () => {
    const start = new Date(2026, 7, 24, 23, 0);
    const end = new Date(2026, 7, 25, 3, 0);
    const segments = splitByDay(start, end);
    expect(segments.map((s) => s.date)).toEqual(["2026-08-24", "2026-08-25"]);
    expect(segments[0].minutes).toBe(60);
    expect(segments[1].minutes).toBe(180);
    // The boundary is shared exactly — no gap, no overlap.
    expect(segments[0].end.getTime()).toBe(segments[1].start.getTime());
  });

  it("splits a multi-day shift into one segment per calendar day", () => {
    const start = new Date(2026, 7, 24, 22, 0);
    const end = new Date(2026, 7, 26, 6, 30);
    const segments = splitByDay(start, end);
    expect(segments.map((s) => s.date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
    const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);
    const wallClockMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    expect(totalMinutes).toBe(wallClockMinutes);
  });

  it("returns nothing for a zero-length or inverted range", () => {
    const t = new Date(2026, 7, 24, 12, 0);
    expect(splitByDay(t, t)).toHaveLength(0);
    expect(splitByDay(t, addDays(t, -1))).toHaveLength(0);
  });
});

describe("combineDateAndTime", () => {
  it("combines a date key and HH:MM into one Date", () => {
    const d = combineDateAndTime("2026-08-24", "14:30");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 24, 14, 30,
    ]);
  });
});

describe("dayIndexOf", () => {
  it("returns 0 for the week's Monday and 6 for its Sunday", () => {
    const weekStart = fromDateKey("2026-08-24");
    expect(dayIndexOf("2026-08-24", weekStart)).toBe(0);
    expect(dayIndexOf("2026-08-30", weekStart)).toBe(6);
  });

  it("returns a negative index for a date before the week starts", () => {
    const weekStart = fromDateKey("2026-08-24");
    expect(dayIndexOf("2026-08-23", weekStart)).toBe(-1);
  });
});

describe("orderByRecency", () => {
  const items = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("puts the most recently-used items first, most recent first, deduped", () => {
    const entries = [
      { projectId: "a", startTime: "2026-08-20T09:00:00Z" },
      { projectId: "b", startTime: "2026-08-22T09:00:00Z" },
      { projectId: "a", startTime: "2026-08-21T09:00:00Z" },
    ];
    const { recent, rest } = orderByRecency(items, entries);
    expect(recent.map((i) => i.id)).toEqual(["b", "a"]);
    expect(rest.map((i) => i.id)).toEqual(["c"]);
  });

  it("ignores entries with no projectId and returns everything as rest when there's no history", () => {
    const { recent, rest } = orderByRecency(items, [{ projectId: null, startTime: "x" }]);
    expect(recent).toHaveLength(0);
    expect(rest).toHaveLength(3);
  });

  it("caps the recent list at max", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: String(i) }));
    const entries = many
      .map((i) => ({ projectId: i.id, startTime: `2026-08-${10 + Number(i.id)}T00:00:00Z` }))
      .reverse();
    const { recent } = orderByRecency(many, entries, 3);
    expect(recent).toHaveLength(3);
  });
});

describe("orderByRecencyName", () => {
  it("matches entries to items by name, not id", () => {
    const items = [
      { id: "1", name: "Design" },
      { id: "2", name: "Dev" },
    ];
    const entries = [
      { task: "Dev", startTime: "2026-08-20T09:00:00Z" },
      { task: "Design", startTime: "2026-08-22T09:00:00Z" },
    ];
    const { recent, rest } = orderByRecencyName(items, entries);
    expect(recent.map((i) => i.name)).toEqual(["Design", "Dev"]);
    expect(rest).toHaveLength(0);
  });
});

describe("composeWeeklySchedule / parseWeeklySchedule round-trip", () => {
  it("composes a contiguous weekday range with a time range", () => {
    const days = [true, true, true, true, true, false, false];
    expect(composeWeeklySchedule(days, "09:00", "17:00")).toBe("Mon–Fri, 9am–5pm");
  });

  it("composes non-contiguous days without a time range", () => {
    const days = [true, false, true, false, false, false, false];
    expect(composeWeeklySchedule(days, "", "")).toBe("Mon, Wed");
  });

  it("returns empty when nothing is selected", () => {
    expect(composeWeeklySchedule([false, false, false, false, false, false, false], "", "")).toBe(
      "",
    );
  });

  it("parses back what it just composed", () => {
    const days = [true, true, true, true, true, false, false];
    const text = composeWeeklySchedule(days, "09:00", "17:00");
    const parsed = parseWeeklySchedule(text);
    expect(parsed.days).toEqual(days);
    expect(parsed.start).toBe("09:00");
    expect(parsed.end).toBe("17:00");
  });

  it("recognizes 'weekdays' as a shorthand", () => {
    const parsed = parseWeeklySchedule("Weekdays, 9am-5pm");
    expect(parsed.days).toEqual([true, true, true, true, true, false, false]);
    expect(parsed.start).toBe("09:00");
    expect(parsed.end).toBe("17:00");
  });

  it("never throws on text it can't make sense of", () => {
    expect(() => parseWeeklySchedule("¯\\_(ツ)_/¯")).not.toThrow();
    const parsed = parseWeeklySchedule("¯\\_(ツ)_/¯");
    expect(parsed.days).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("expandWeeklyScheduleToDays / summarizeWeeklyScheduleDays (L32)", () => {
  it("expands a shared day/start/end selection into one entry per selected day", () => {
    const days = [true, true, true, true, true, false, false];
    expect(expandWeeklyScheduleToDays(days, "09:00", "17:00")).toEqual([
      { start: "09:00", end: "17:00" },
      { start: "09:00", end: "17:00" },
      { start: "09:00", end: "17:00" },
      { start: "09:00", end: "17:00" },
      { start: "09:00", end: "17:00" },
      null,
      null,
    ]);
  });

  it("treats an empty selection, or missing times, as entirely off", () => {
    expect(isEmptyWeeklyScheduleDays(null)).toBe(true);
    const allOff = [false, false, false, false, false, false, false];
    expect(isEmptyWeeklyScheduleDays(expandWeeklyScheduleToDays(allOff, "09:00", "17:00"))).toBe(
      true,
    );
    expect(isEmptyWeeklyScheduleDays(expandWeeklyScheduleToDays([true], "", ""))).toBe(true);
  });

  it("groups consecutive days sharing identical hours into one range", () => {
    const weekdays = [true, true, true, true, true, false, false];
    const days = expandWeeklyScheduleToDays(weekdays, "09:00", "17:00");
    expect(summarizeWeeklyScheduleDays(days)).toBe("Mon–Fri 9am–5pm");
  });

  it("keeps a day with different hours as its own segment", () => {
    const weekdays = [true, true, true, true, true, false, false];
    const days = expandWeeklyScheduleToDays(weekdays, "09:00", "17:00");
    days[4] = { start: "09:00", end: "13:00" }; // shorter Friday
    expect(summarizeWeeklyScheduleDays(days)).toBe("Mon–Thu 9am–5pm, Fri 9am–1pm");
  });

  it("reports 'Not set' for a fully-off week", () => {
    expect(summarizeWeeklyScheduleDays(null)).toBe("Not set");
    expect(summarizeWeeklyScheduleDays([null, null, null, null, null, null, null])).toBe("Not set");
  });
});

describe("convertTimeRange", () => {
  it("returns null when the two timezones are the same", () => {
    expect(convertTimeRange("09:00", "17:00", "Australia/Sydney", "Australia/Sydney")).toBeNull();
  });

  it("returns null when either time is missing or malformed", () => {
    expect(convertTimeRange("", "17:00", "Australia/Sydney", "Asia/Manila")).toBeNull();
    expect(convertTimeRange("9am", "17:00", "Australia/Sydney", "Asia/Manila")).toBeNull();
  });

  it("shifts a time range between two real timezones", () => {
    // Australia/Sydney and Asia/Manila are both in this app's own
    // timezones list (workspace/types.ts) — a real pairing, not an
    // arbitrary one.
    const result = convertTimeRange("09:00", "17:00", "Australia/Sydney", "Asia/Manila");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\d{1,2}(:\d{2})?(am|pm)–\d{1,2}(:\d{2})?(am|pm)/);
  });
});
