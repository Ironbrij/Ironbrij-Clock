import { SERVICE_LINE_LABELS, isInternalWork } from "@/components/reports/report-config";
import type { WorkspaceEntry, WorkspaceProject } from "@/lib/workspace/types";

type BreakdownEntry = Pick<
  WorkspaceEntry,
  "projectId" | "task" | "description" | "seconds" | "running" | "serviceCategory"
>;
type BreakdownProject = Pick<WorkspaceProject, "name" | "client" | "clientId">;

export type BreakdownTask = { label: string; seconds: number };

export type BreakdownGroup = {
  /** "internal", or the client's id. */
  key: string;
  label: string;
  internal: boolean;
  seconds: number;
  /** 0–1 of the total. */
  share: number;
  tasks: BreakdownTask[];
};

const INTERNAL_KEY = "internal";

const bySecondsThenLabel = (a: { seconds: number; label: string }, b: typeof a) =>
  b.seconds - a.seconds || a.label.localeCompare(b.label);

/**
 * What someone's time went on, for History's Breakdown view: Ironbrij's own
 * work first, then each client from most hours to least, with the tasks
 * under each added up. "Internal" is the Reports rule (isInternalWork), not
 * the billable flag, which the Ironbrij project itself carries. A task is
 * named the way Copy EOD names it, and stretches of the same task count
 * once whatever their case or spacing. A running timer isn't counted until
 * it stops.
 */
export function buildWorkBreakdown(
  entries: BreakdownEntry[],
  projectById: (id: string | null) => BreakdownProject | undefined,
): { totalSeconds: number; groups: BreakdownGroup[] } {
  const groups = new Map<
    string,
    Omit<BreakdownGroup, "share" | "tasks"> & { tasks: Map<string, BreakdownTask> }
  >();
  let totalSeconds = 0;

  for (const e of entries) {
    if (e.running || e.seconds <= 0) continue;
    const project = projectById(e.projectId);
    const clientId = project?.clientId ?? null;
    const internal = isInternalWork({ serviceCategory: e.serviceCategory, clientId });
    const key = internal ? INTERNAL_KEY : clientId!;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: internal ? SERVICE_LINE_LABELS.ironbrij : project!.client,
        internal,
        seconds: 0,
        tasks: new Map(),
      };
      groups.set(key, group);
    }
    const label = e.description.trim() || e.task.trim() || project?.name || "No description";
    const taskKey = label.toLowerCase();
    const task = group.tasks.get(taskKey) ?? { label, seconds: 0 };
    task.seconds += e.seconds;
    group.tasks.set(taskKey, task);
    group.seconds += e.seconds;
    totalSeconds += e.seconds;
  }

  const ordered = [...groups.values()].sort(
    (a, b) => Number(b.internal) - Number(a.internal) || bySecondsThenLabel(a, b),
  );
  return {
    totalSeconds,
    groups: ordered.map((g) => ({
      ...g,
      share: g.seconds / totalSeconds,
      tasks: [...g.tasks.values()].sort(bySecondsThenLabel),
    })),
  };
}
