import { describe, expect, it } from "vitest";
import { buildDayTimeline } from "./day-timeline";

type Entry = Parameters<typeof buildDayTimeline>[0][number];

const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00`).getTime();
let nextId = 0;
const entry = (start: string, end: string | null, over: Partial<Entry> = {}): Entry => ({
  id: `e${++nextId}`,
  startTime: `2026-10-20T${start}:00`,
  endTime: end ? `2026-10-20T${end}:00` : null,
  running: end === null,
  seconds: 0,
  ...over,
});

const shape = (items: ReturnType<typeof buildDayTimeline>["items"]) =>
  items.map((i) => (i.kind === "gap" ? `gap ${i.minutes}m` : `entry ${i.entry.id}`));

describe("buildDayTimeline", () => {
  it("lists entries in time order with the untracked gaps between them", () => {
    const a = entry("09:00", "10:15", { id: "a" });
    const b = entry("10:40", "12:00", { id: "b" });
    const c = entry("13:00", "14:00", { id: "c" });
    const { items } = buildDayTimeline([c, a, b]);
    expect(shape(items)).toEqual(["entry a", "gap 25m", "entry b", "gap 60m", "entry c"]);
  });

  it("ignores gaps shorter than the minimum", () => {
    const { items } = buildDayTimeline([
      entry("09:00", "10:00", { id: "a" }),
      entry("10:04", "11:00", { id: "b" }),
    ]);
    expect(shape(items)).toEqual(["entry a", "entry b"]);
  });

  it("shows no gap between back-to-back or overlapping entries", () => {
    const { items } = buildDayTimeline([
      entry("09:00", "11:00", { id: "a" }),
      entry("10:30", "10:45", { id: "b" }),
      entry("11:00", "12:00", { id: "c" }),
    ]);
    expect(shape(items)).toEqual(["entry a", "entry b", "entry c"]);
  });

  it("runs a running timer up to now", () => {
    const { items, spanEnd } = buildDayTimeline(
      [entry("09:00", "10:00", { id: "a" }), entry("10:30", null, { id: "b" })],
      { now: at("11:15") },
    );
    expect(shape(items)).toEqual(["entry a", "gap 30m", "entry b"]);
    expect(spanEnd).toBe(at("11:15"));
  });

  it("falls back to the tracked duration when an entry has no end time", () => {
    const { spanEnd } = buildDayTimeline([entry("09:00", null, { running: false, seconds: 5400 })]);
    expect(spanEnd).toBe(at("10:30"));
  });

  it("spans from the first start to the last end", () => {
    const { spanStart, spanEnd } = buildDayTimeline([
      entry("13:00", "14:00"),
      entry("08:30", "09:00"),
    ]);
    expect([spanStart, spanEnd]).toEqual([at("08:30"), at("14:00")]);
  });

  it("is empty for a day with nothing logged", () => {
    expect(buildDayTimeline([])).toEqual({ items: [], spanStart: null, spanEnd: null });
  });
});
