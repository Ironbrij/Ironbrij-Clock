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
  // Real-world UTC offsets are always whole minutes, but asUtc is built
  // from whole-second formatToParts values while date.getTime() carries
  // sub-second precision — their difference lands a fraction of a second
  // off a clean multiple of 60_000, which without rounding shows up later
  // as garbage like "6:59.99999999999994am" instead of "7:00am".
  return Math.round((asUtc - date.getTime()) / 60_000);
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

/** Minutes-of-day from one SCHEDULE_TIME_RE match's capture groups (h12, m12, ampm, h24, m24). */
function minutesFromTimeMatch(
  h12: string | undefined,
  m12: string | undefined,
  ampm: string | undefined,
  h24: string | undefined,
  m24: string | undefined,
): number {
  if (ampm) {
    let h = Number(h12) % 12;
    if (ampm.toLowerCase() === "pm") h += 12;
    return h * 60 + Number(m12 ?? 0);
  }
  return Number(h24) * 60 + Number(m24);
}

/** minutes-of-day, shifted by `diffMinutes` and wrapped into [0, 1440), with a "(+1d)"/"(-1d)" suffix when it crosses midnight into a different day. */
function shiftAndFormat(minutesInDay: number, diffMinutes: number): string {
  const shifted = minutesInDay + diffMinutes;
  const dayShift = Math.floor(shifted / 1440);
  const wrapped = shifted - dayShift * 1440;
  const label = formatClockMinutes(wrapped);
  return dayShift === 0 ? label : `${label}(${dayShift > 0 ? "+" : ""}${dayShift}d)`;
}

/**
 * Converts a start–end time range (as `<input type="time">` HH:MM values)
 * from one IANA timezone to another — e.g. what a 9am–5pm shift in Manila
 * looks like on an Australia/Sydney clock. Returns null when there's
 * nothing to convert (either time missing, or the two zones are the same).
 */
export function convertTimeRange(
  start: string,
  end: string,
  fromTz: string,
  toTz: string,
): string | null {
  const startMin = timeInputToMinutes(start);
  const endMin = timeInputToMinutes(end);
  if (startMin == null || endMin == null || !fromTz || !toTz || fromTz === toTz) return null;
  const now = new Date();
  const diff = timezoneOffsetMinutes(now, toTz) - timezoneOffsetMinutes(now, fromTz);
  if (diff === 0) return null;
  return `${shiftAndFormat(startMin, diff)}–${shiftAndFormat(endMin, diff)}`;
}

/** Mon(0)…Sun(6) — the order the structured schedule editor and its parser/composer agree on. */
export const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAY_ALIASES: [string, number][] = [
  ["monday", 0],
  ["mon", 0],
  ["tuesday", 1],
  ["tues", 1],
  ["tue", 1],
  ["wednesday", 2],
  ["wed", 2],
  ["thursday", 3],
  ["thurs", 3],
  ["thu", 3],
  ["friday", 4],
  ["fri", 4],
  ["saturday", 5],
  ["sat", 5],
  ["sunday", 6],
  ["sun", 6],
];

function dayIndexFromWord(word: string): number {
  const hit = WEEKDAY_ALIASES.find(([alias]) => alias === word.toLowerCase());
  return hit ? hit[1] : -1;
}

function timeInputToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minutesToTimeInputValue(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Groups a Mon…Sun boolean selection into ranges, e.g. [T,T,T,T,T,F,F] → "Mon–Fri", [T,F,T,F,F,F,F] → "Mon, Wed". */
function formatDayRanges(days: boolean[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    if (!days[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && days[j + 1]) j++;
    parts.push(j > i ? `${WEEKDAY_ABBR[i]}–${WEEKDAY_ABBR[j]}` : WEEKDAY_ABBR[i]);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Builds the same free-text form the schedule column stores, from the structured picker's state. Empty when no days are selected. */
export function composeWeeklySchedule(days: boolean[], start: string, end: string): string {
  const dayPart = formatDayRanges(days);
  if (!dayPart) return "";
  const startMin = timeInputToMinutes(start);
  const endMin = timeInputToMinutes(end);
  if (startMin == null || endMin == null) return dayPart;
  return `${dayPart}, ${formatClockMinutes(startMin)}–${formatClockMinutes(endMin)}`;
}

/**
 * Best-effort inverse of composeWeeklySchedule, for initializing the
 * structured picker from whatever's already stored as free text (including
 * schedules that predate the picker, or ones an admin typed by hand).
 * Recognizes weekday names/abbreviations, "Day–Day" ranges, "weekdays"/
 * "weekends"/"daily", and the first two recognizable clock times as
 * start/end. Anything it can't recognize is simply left unselected — it
 * never throws, and the caller still has the original text to fall back on.
 */
export function parseWeeklySchedule(text: string): { days: boolean[]; start: string; end: string } {
  const days = [false, false, false, false, false, false, false];
  const lower = text.toLowerCase();

  if (/\bweekdays?\b/.test(lower)) for (let i = 0; i <= 4; i++) days[i] = true;
  if (/\bweekends?\b/.test(lower)) {
    days[5] = true;
    days[6] = true;
  }
  if (/\b(everyday|every day|daily|all days)\b/.test(lower)) days.fill(true);

  const rangeRe = /([a-z]+)\s*(?:–|—|-|to)\s*([a-z]+)/gi;
  let range: RegExpExecArray | null;
  while ((range = rangeRe.exec(text))) {
    const a = dayIndexFromWord(range[1]);
    const b = dayIndexFromWord(range[2]);
    if (a === -1 || b === -1) continue;
    const [from, to] = a <= b ? [a, b] : [b, a];
    for (let i = from; i <= to; i++) days[i] = true;
  }

  const wordRe = /[a-z]+/gi;
  let word: RegExpExecArray | null;
  while ((word = wordRe.exec(text))) {
    const idx = dayIndexFromWord(word[0]);
    if (idx !== -1) days[idx] = true;
  }

  const toMinutes = (match: RegExpMatchArray) =>
    minutesFromTimeMatch(match[1], match[2], match[3], match[4], match[5]);
  const timeMatches = Array.from(text.matchAll(SCHEDULE_TIME_RE));
  const start = timeMatches[0] ? minutesToTimeInputValue(toMinutes(timeMatches[0])) : "";
  const end = timeMatches[1] ? minutesToTimeInputValue(toMinutes(timeMatches[1])) : "";

  return { days, start, end };
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
