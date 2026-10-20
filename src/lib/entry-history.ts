import {
  ENTRIES_HISTORY_DAYS,
  addDays,
  formatClock,
  startOfWeek,
  toDateKey,
} from "@/lib/time-utils";
import type { WorkspaceEntry, WorkspaceProject } from "@/lib/workspace/types";

export type HistoryPreset =
  "this-week" | "last-week" | "this-month" | "last-month" | "last-30" | "last-90" | "all";

export const HISTORY_PRESETS: { id: HistoryPreset; label: string }[] = [
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-30", label: "Last 30 days" },
  { id: "last-90", label: "Last 90 days" },
  { id: "all", label: "Everything" },
];

type HistoryEntry = Pick<
  WorkspaceEntry,
  | "id"
  | "date"
  | "startTime"
  | "endTime"
  | "seconds"
  | "running"
  | "billable"
  | "projectId"
  | "task"
  | "description"
>;
type HistoryProject = Pick<WorkspaceProject, "name" | "client" | "clientId">;
type ProjectLookup = (id: string | null) => HistoryProject | undefined;

export type HistoryFilters = {
  /** Inclusive date keys (YYYY-MM-DD). */
  from: string;
  to: string;
  search: string;
  projectId: string | null;
  clientId: string | null;
};

/**
 * The first day whose entries are actually loaded: your own entries come
 * from a rolling ENTRIES_HISTORY_DAYS window (useTimeEntriesData), so a day
 * before this isn't empty, just unfetched. History stops here and says so.
 * Deliberately the exact day rather than oldestLoadedWeekStart(), which
 * rounds back to a Monday the window may only partly cover.
 */
export function historyFloorKey(today: Date): string {
  return toDateKey(addDays(today, -ENTRIES_HISTORY_DAYS));
}

export function historyRangeForPreset(preset: HistoryPreset, today: Date) {
  const todayKey = toDateKey(today);
  const weekStart = startOfWeek(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const range = (from: Date, to: Date | string) => ({
    from: clampToFloor(toDateKey(from), today),
    to: typeof to === "string" ? to : toDateKey(to),
  });
  switch (preset) {
    case "this-week":
      return range(weekStart, addDays(weekStart, 6));
    case "last-week":
      return range(addDays(weekStart, -7), addDays(weekStart, -1));
    case "this-month":
      return range(monthStart, new Date(today.getFullYear(), today.getMonth() + 1, 0));
    case "last-month":
      return range(new Date(today.getFullYear(), today.getMonth() - 1, 1), addDays(monthStart, -1));
    case "last-30":
      return range(addDays(today, -29), todayKey);
    case "last-90":
      return range(addDays(today, -89), todayKey);
    case "all":
      return { from: historyFloorKey(today), to: todayKey };
  }
}

function clampToFloor(dateKey: string, today: Date) {
  const floor = historyFloorKey(today);
  return dateKey < floor ? floor : dateKey;
}

/** A client name only for a project that really has one — not the "Internal — no client" placeholder. */
function clientName(project: HistoryProject | undefined) {
  return project?.clientId ? project.client : "";
}

export function filterHistoryEntries<T extends HistoryEntry>(
  entries: T[],
  filters: HistoryFilters,
  projectById: ProjectLookup,
): T[] {
  const words = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (e.date < filters.from || e.date > filters.to) return false;
    if (filters.projectId && e.projectId !== filters.projectId) return false;
    const project = projectById(e.projectId);
    if (filters.clientId && project?.clientId !== filters.clientId) return false;
    if (words.length === 0) return true;
    const haystack = [e.description, e.task, project?.name ?? "", clientName(project)]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

const byStart = (a: HistoryEntry, b: HistoryEntry) =>
  new Date(a.startTime).getTime() - new Date(b.startTime).getTime();

/** Newest day first; within a day, the order the work happened. */
export function groupEntriesByDay<T extends HistoryEntry>(
  entries: T[],
): { date: string; entries: T[]; seconds: number }[] {
  const byDate = new Map<string, T[]>();
  for (const e of entries) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  return Array.from(byDate, ([date, list]) => ({
    date,
    entries: list.sort(byStart),
    seconds: list.reduce((s, e) => s + e.seconds, 0),
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Oldest first, the order a spreadsheet reads best in. */
export function historyCsvRows(entries: HistoryEntry[], projectById: ProjectLookup): string[][] {
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? byStart(a, b) : a.date < b.date ? -1 : 1,
  );
  return [
    ["Date", "Start", "End", "Hours", "Project", "Client", "Task", "Description", "Billable"],
    ...sorted.map((e) => {
      const project = projectById(e.projectId);
      return [
        e.date,
        formatClock(e.startTime),
        e.endTime && !e.running ? formatClock(e.endTime) : "",
        (e.seconds / 3600).toFixed(2),
        project?.name ?? "",
        clientName(project),
        e.task,
        e.description,
        e.billable ? "Yes" : "No",
      ];
    }),
  ];
}
