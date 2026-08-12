export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * How far back the entries query loads (see use-time-entries.ts). Shared
 * with the UI so Grid/Timesheet navigation can stop honestly at the edge
 * of what's actually loaded, instead of silently rendering an empty week
 * that's indistinguishable from a genuinely empty one.
 */
export const ENTRIES_HISTORY_DAYS = 400;

export function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The start of the earliest week whose entries are actually loaded — anything before this is unfetched, not empty. */
export function oldestLoadedWeekStart() {
  return startOfWeek(addDays(new Date(), -ENTRIES_HISTORY_DAYS));
}

export function toDateKey(date: Date) {
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function fromDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Splits [start, end) into one segment per calendar day it touches, using
 * local time — the same notion of "day" toDateKey already uses everywhere
 * else in this app, not UTC. A timer run 11pm-3am produces two segments,
 * one ending at local midnight and one starting there, instead of one
 * entry whose full duration gets misattributed to the day it started on.
 * A span that never crosses midnight returns a single segment covering
 * the whole range unchanged.
 */
export function splitByDay(start: Date, end: Date) {
  const segments: { date: string; start: Date; end: Date; minutes: number }[] = [];
  let segStart = start;
  while (segStart < end) {
    const dayEnd = new Date(
      segStart.getFullYear(),
      segStart.getMonth(),
      segStart.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    const segEnd = dayEnd < end ? dayEnd : end;
    segments.push({
      date: toDateKey(segStart),
      start: segStart,
      end: segEnd,
      minutes: Math.round((segEnd.getTime() - segStart.getTime()) / 60000),
    });
    segStart = segEnd;
  }
  return segments;
}

export function combineDateAndTime(dateKey: string, time: string) {
  const date = fromDateKey(dateKey);
  const [h, m] = time.split(":").map(Number);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date;
}

/** Splits a list into "recently used" (by most recent matching entry) and everything else, for quick-access dropdowns. */
export function orderByRecency<T extends { id: string }>(
  items: T[],
  entries: { projectId: string | null; startTime: string }[],
  max = 5,
): { recent: T[]; rest: T[] } {
  const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));
  const recentIds: string[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    if (e.projectId && !seen.has(e.projectId)) {
      seen.add(e.projectId);
      recentIds.push(e.projectId);
    }
    if (recentIds.length >= max) break;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const recent = recentIds.map((id) => byId.get(id)).filter((i): i is T => !!i);
  const recentSet = new Set(recent.map((i) => i.id));
  const rest = items.filter((i) => !recentSet.has(i.id));
  return { recent, rest };
}

/** Same idea as orderByRecency, but for lists matched by name instead of id — tasks are picked by name, not a stored reference. */
export function orderByRecencyName<T extends { id: string; name: string }>(
  items: T[],
  entries: { task: string; startTime: string }[],
  max = 5,
): { recent: T[]; rest: T[] } {
  const sorted = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));
  const recentNames: string[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    if (e.task && !seen.has(e.task)) {
      seen.add(e.task);
      recentNames.push(e.task);
    }
    if (recentNames.length >= max) break;
  }
  const byName = new Map(items.map((i) => [i.name, i]));
  const recent = recentNames.map((n) => byName.get(n)).filter((i): i is T => !!i);
  const recentSet = new Set(recent.map((i) => i.id));
  const rest = items.filter((i) => !recentSet.has(i.id));
  return { recent, rest };
}

export function dayIndexOf(dateKey: string, weekStart: Date) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return Math.round((date.getTime() - weekStart.getTime()) / 86_400_000);
}

export function formatDayLong(date: Date) {
  return date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

export function formatWeekRange(weekStart: Date) {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const left = weekStart.toLocaleDateString(
    "en-AU",
    sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" },
  );
  const right = end.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
  return `${left} – ${right}`;
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
