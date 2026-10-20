import type { WorkspaceEntry, WorkspaceProject } from "@/lib/workspace/types";

export type SplitBy = "project" | "client" | "category";

export type TimeSlice = {
  key: string;
  label: string;
  seconds: number;
  /** 0–1 of the total. */
  share: number;
  /** The project's own colour when splitting by project; null otherwise, for the chart to give a palette slot. */
  color: string | null;
  isOther: boolean;
};

type SplitEntry = Pick<WorkspaceEntry, "projectId" | "seconds" | "task">;
type SplitProject = Pick<WorkspaceProject, "name" | "client" | "clientId" | "color">;

/**
 * Hours split into donut slices, Clockify-style: biggest first, ties by
 * name so the order doesn't jump between renders. Past `maxSlices` the
 * smallest groups fold into one "Other" slice at the end — a donut stops
 * being readable beyond about six segments.
 */
export function splitTime(
  entries: SplitEntry[],
  by: SplitBy,
  projectById: (id: string | null) => SplitProject | undefined,
  { maxSlices = 6 }: { maxSlices?: number } = {},
): TimeSlice[] {
  const groups = new Map<string, { label: string; seconds: number; color: string | null }>();
  for (const e of entries) {
    if (e.seconds <= 0) continue;
    const project = projectById(e.projectId);
    const [key, label, color] =
      by === "project"
        ? [e.projectId ?? "none", project?.name ?? "No project", project?.color ?? null]
        : by === "client"
          ? project?.clientId
            ? [project.clientId, project.client, null]
            : ["internal", "Internal", null]
          : [e.task.trim() || "none", e.task.trim() || "No category", null];
    const group = groups.get(key);
    if (group) group.seconds += e.seconds;
    else groups.set(key, { label, seconds: e.seconds, color });
  }

  const total = Array.from(groups.values()).reduce((s, g) => s + g.seconds, 0);
  if (total === 0) return [];

  const sorted = Array.from(groups, ([key, g]) => ({ key, ...g })).sort(
    (a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label),
  );
  const kept = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
  const rest = sorted.slice(kept.length);

  const slices: TimeSlice[] = kept.map((g) => ({
    ...g,
    share: g.seconds / total,
    isOther: false,
  }));
  if (rest.length > 0) {
    const seconds = rest.reduce((s, g) => s + g.seconds, 0);
    slices.push({
      key: "other",
      label: "Other",
      seconds,
      share: seconds / total,
      color: null,
      isOther: true,
    });
  }
  return slices;
}
