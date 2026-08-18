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

/** Minutes such that localTime = UTC + offset, for `timeZone` at `date`. */
function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60_000;
}

function formatClockMinutes(minutesInDay: number) {
  const h24 = Math.floor(minutesInDay / 60);
  const m = minutesInDay % 60;
  const period = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

const SCHEDULE_TIME_RE =
  /\b(\d{1,2})(?::([0-5]\d))?\s*([AaPp][Mm])\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

/**
 * Best-effort conversion of the clock times inside a free-text weekly
 * schedule (e.g. "Mon–Fri, 9am–5pm") from one IANA timezone to another.
 * Deliberately regex-based, not a real schedule parser — weekly_schedule is
 * kept as free text on purpose (see the member_employment migration), so
 * this only rewrites tokens it recognizes (h(:mm)am/pm, or 24-hour HH:MM)
 * and leaves everything else untouched. Returns null when there's nothing
 * to convert (no recognizable time, or the two zones are the same).
 */
export function convertScheduleTimes(
  schedule: string,
  fromTz: string,
  toTz: string,
): string | null {
  if (!schedule.trim() || !fromTz || !toTz || fromTz === toTz) return null;
  const now = new Date();
  const diff = timezoneOffsetMinutes(now, toTz) - timezoneOffsetMinutes(now, fromTz);
  if (diff === 0) return null;

  let matched = false;
  const result = schedule.replace(
    SCHEDULE_TIME_RE,
    (
      _match: string,
      h12: string | undefined,
      m12: string | undefined,
      ampm: string | undefined,
      h24: string | undefined,
      m24: string | undefined,
    ) => {
      matched = true;
      let totalMinutes: number;
      if (ampm) {
        let h = Number(h12) % 12;
        if (ampm.toLowerCase() === "pm") h += 12;
        totalMinutes = h * 60 + Number(m12 ?? 0);
      } else {
        totalMinutes = Number(h24) * 60 + Number(m24);
      }
      const shifted = totalMinutes + diff;
      const dayShift = Math.floor(shifted / 1440);
      const wrapped = shifted - dayShift * 1440;
      const label = formatClockMinutes(wrapped);
      return dayShift === 0 ? label : `${label}(${dayShift > 0 ? "+" : ""}${dayShift}d)`;
    },
  );
  return matched ? result : null;
}

const FALLBACK_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Asia/Manila",
  "Pacific/Auckland",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

function timezoneOffsetLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * Full IANA timezone list (each labeled with its current UTC offset) when
 * the runtime supports `Intl.supportedValuesOf`, falling back to a short
 * curated list of the zones this workspace actually spans otherwise.
 */
export function listTimezones(): { value: string; label: string }[] {
  let zones: string[];
  try {
    zones =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : FALLBACK_TIMEZONES;
  } catch {
    zones = FALLBACK_TIMEZONES;
  }
  return zones
    .map((tz) => {
      const offset = timezoneOffsetLabel(tz);
      const name = tz.replace(/_/g, " ");
      return { value: tz, label: offset ? `${name} (${offset})` : name };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
