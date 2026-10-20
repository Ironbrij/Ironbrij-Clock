import { useState } from "react";
import { Lock, Pencil, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProjectDot } from "@/components/app-shell";
import { EntryFormDialog } from "@/components/entry-form-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/mock-data";
import { formatClock, formatDayLong, fromDateKey, startOfWeek } from "@/lib/time-utils";
import { useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";

/**
 * Your own entries as a list with repeat/edit/delete, honoring locked
 * (submitted/approved) weeks. Shared by the Time page's day cards and
 * History — both only ever pass the signed-in person's own entries.
 */
export function EntryList({ entries }: { entries: WorkspaceEntry[] }) {
  const { projectById, deleteEntry, startTimer, runningEntry, timesheetForWeek } = useWorkspace();
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<WorkspaceEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<WorkspaceEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (entries.length === 0) {
    return <p className="px-6 py-6 text-sm text-muted-foreground">No time logged on this day.</p>;
  }

  const repeatEntry = async (entry: WorkspaceEntry) => {
    if (!entry.projectId) {
      toast.error("Can't repeat this entry", {
        description: "It doesn't have a project attached.",
      });
      return;
    }
    // The project pickers elsewhere only ever offer active projects
    // (`!p.archived`) — repeat used to skip that check entirely and hand
    // startTimer an archived project id directly.
    if (projectById(entry.projectId)?.archived) {
      toast.error("Can't repeat this entry", {
        description: "Its project has been archived — pick an active project instead.",
      });
      return;
    }
    if (runningEntry) {
      toast.error("A timer is already running", {
        description: "Stop it first, then repeat this entry.",
      });
      return;
    }
    setRepeatingId(entry.id);
    try {
      await startTimer({
        projectId: entry.projectId,
        task: entry.task,
        description: entry.description,
      });
      toast.success("Timer started", { description: "Picked up right where that entry left off." });
    } catch (error) {
      toast.error("Couldn't start that", { description: (error as Error).message });
    } finally {
      setRepeatingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deletingEntry) return;
    setDeleting(true);
    try {
      await deleteEntry(deletingEntry.id);
      toast.success("Entry deleted");
      setDeletingEntry(null);
    } catch (error) {
      toast.error("Couldn't delete that", { description: (error as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ul className="divide-y divide-border">
        {entries.map((entry) => {
          const p = projectById(entry.projectId);
          const weekStatus = timesheetForWeek(startOfWeek(fromDateKey(entry.date)))?.status;
          const locked = weekStatus === "Submitted" || weekStatus === "Approved";
          return (
            <li
              key={entry.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/50"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProjectDot color={p?.color ?? "var(--muted-foreground)"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {entry.description || "No description"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p?.name ?? "No project"} · {entry.task || "—"} · from{" "}
                    {formatClock(entry.startTime)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums text-sm font-medium">
                  {entry.running ? "running" : formatDuration(entry.seconds)}
                </span>
                {locked ? (
                  <span
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground"
                    title="This week is locked — ask your manager to send it back to edit this entry"
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">
                      Locked — ask your manager to send this week back to edit it
                    </span>
                  </span>
                ) : entry.running ? (
                  // A stuck timer's start time can be corrected without
                  // stopping it first — the only edit not gated behind
                  // !entry.running like Repeat/Delete below.
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Edit entry"
                    title="Fix when this timer started"
                    onClick={() => setEditingEntry(entry)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Repeat this entry"
                      title="Start a new timer with the same project, task and description"
                      disabled={!!runningEntry || repeatingId === entry.id}
                      onClick={() => void repeatEntry(entry)}
                    >
                      <Repeat className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit entry"
                      onClick={() => setEditingEntry(entry)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete entry"
                      onClick={() => setDeletingEntry(entry)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <EntryFormDialog
        open={!!editingEntry}
        onOpenChange={(open) => !open && setEditingEntry(null)}
        entry={editingEntry}
      />

      <AlertDialog open={!!deletingEntry} onOpenChange={(open) => !open && setDeletingEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingEntry
                ? `“${deletingEntry.description || "No description"}” — ${formatDuration(
                    deletingEntry.seconds,
                  )} on ${formatDayLong(fromDateKey(deletingEntry.date))}. This can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void confirmDelete()}>
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
