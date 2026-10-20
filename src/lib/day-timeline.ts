import type { WorkspaceEntry } from "@/lib/workspace/types";

type TimelineEntry = Pick<WorkspaceEntry, "id" | "startTime" | "endTime" | "running" | "seconds">;

export type TimelineItem<T> =
  | { kind: "entry"; entry: T; start: number; end: number }
  | { kind: "gap"; start: number; end: number; minutes: number };

/**
 * One day as the Dashboard's "My day" shows it: entries in the order they
 * happened, with an explicit gap item wherever at least `minGapMinutes`
 * went untracked. Times are epoch milliseconds. A running timer runs to
 * `now`; a stopped entry missing its end time falls back to its tracked
 * duration. Overlapping entries never produce a negative gap — the next
 * gap is measured from the latest end so far.
 */
export function buildDayTimeline<T extends TimelineEntry>(
  entries: T[],
  { minGapMinutes = 5, now = Date.now() }: { minGapMinutes?: number; now?: number } = {},
): { items: TimelineItem<T>[]; spanStart: number | null; spanEnd: number | null } {
  const timed = entries
    .map((entry) => {
      const start = new Date(entry.startTime).getTime();
      const end = entry.running
        ? Math.max(start, now)
        : entry.endTime
          ? new Date(entry.endTime).getTime()
          : start + entry.seconds * 1000;
      return { kind: "entry" as const, entry, start, end };
    })
    .sort((a, b) => a.start - b.start);
  if (timed.length === 0) return { items: [], spanStart: null, spanEnd: null };

  const items: TimelineItem<T>[] = [];
  let latestEnd = timed[0].start;
  for (const item of timed) {
    const gapMinutes = Math.round((item.start - latestEnd) / 60000);
    if (gapMinutes >= minGapMinutes) {
      items.push({ kind: "gap", start: latestEnd, end: item.start, minutes: gapMinutes });
    }
    items.push(item);
    latestEnd = Math.max(latestEnd, item.end);
  }
  return { items, spanStart: timed[0].start, spanEnd: latestEnd };
}
