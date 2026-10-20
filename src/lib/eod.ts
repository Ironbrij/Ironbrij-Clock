import { formatDayLong, toDateKey } from "@/lib/time-utils";
import type { WorkspaceEntry, WorkspaceProject } from "@/lib/workspace/types";

type EodEntry = Pick<WorkspaceEntry, "date" | "startTime" | "projectId" | "task" | "description">;
type EodProject = Pick<WorkspaceProject, "name" | "client" | "clientId">;

/**
 * The plain-text end-of-day message staff paste into Slack or email: what
 * they worked on and for which client, in the order they did it, without
 * times. A task worked on in several stretches (same wording, same client)
 * is listed once. Null when nothing was logged that day, so callers can
 * disable the copy button instead of copying an empty header.
 */
export function buildEodText(
  day: Date,
  entries: EodEntry[],
  projectById: (id: string | null) => EodProject | undefined,
): string | null {
  const dayKey = toDateKey(day);
  const dayEntries = entries
    .filter((e) => e.date === dayKey)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  if (dayEntries.length === 0) return null;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of dayEntries) {
    const project = projectById(e.projectId);
    const label = e.description.trim() || e.task.trim() || project?.name || "No description";
    const client = project?.clientId ? project.client : null;
    const key = `${label.toLowerCase()}\u0000${client ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(client ? `• ${label} – ${client}` : `• ${label}`);
  }

  return [`EOD – ${formatDayLong(day)}`, "", ...lines].join("\n");
}
