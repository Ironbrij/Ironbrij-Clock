export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export function toDateKey(date: Date) {
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${date.getFullYear()}-${m}-${day}`;
}

export function fromDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
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
