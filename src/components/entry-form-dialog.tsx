import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProjectDot } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orderByRecency, orderByRecencyName, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";

const pad = (n: number) => n.toString().padStart(2, "0");

type EntryFormValues = {
  projectId: string;
  task: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
};

function toFormValues(entry: WorkspaceEntry | null, defaultTask: string): EntryFormValues {
  if (!entry) {
    return {
      projectId: "",
      task: defaultTask,
      description: "",
      date: toDateKey(new Date()),
      startTime: "",
      endTime: "",
    };
  }
  const start = new Date(entry.startTime);
  const end = entry.endTime ? new Date(entry.endTime) : start;
  return {
    projectId: entry.projectId ?? "",
    task: entry.task || defaultTask,
    description: entry.description,
    date: entry.date,
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  };
}

/**
 * Shared dialog for both adding a manual entry and editing an existing one —
 * entry is null for "add". Always edits via the entry's own id, not the
 * signed-in user, so it also works for a manager/admin editing someone
 * else's entry (see Manage > Entries) — only "add" (entry === null) is
 * scoped to whoever is signed in, since createEntry always attributes to
 * the caller.
 */
export function EntryFormDialog({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: WorkspaceEntry | null;
}) {
  const { projects, entries, createEntry, updateEntry, settings, taskCategories } = useWorkspace();
  const active = projects.filter((p) => !p.archived);
  const { recent: recentProjects, rest: otherProjects } = orderByRecency(active, entries);
  const { recent: recentTasks, rest: otherTasks } = orderByRecencyName(taskCategories, entries);
  const defaultTask = taskCategories[0]?.name ?? "";
  const [values, setValues] = useState<EntryFormValues>(() => toFormValues(entry, defaultTask));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setValues(toFormValues(entry, defaultTask));
    // defaultTask intentionally excluded — it should only affect the
    // initial value when the dialog opens, not overwrite whatever the
    // person has already picked while it's sitting open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry]);

  const submit = async () => {
    if (!values.projectId) {
      toast.error("Pick a project first");
      return;
    }
    if (!values.startTime || !values.endTime) {
      toast.error("Add a start and end time");
      return;
    }
    if (settings.requireDescriptions && !values.description.trim()) {
      toast.error("Add a description first", {
        description: "Your admin has made descriptions required.",
      });
      return;
    }
    setBusy(true);
    try {
      if (entry) {
        await updateEntry(entry.id, values);
        toast.success("Entry updated");
      } else {
        await createEntry(values);
        toast.success("Entry added", { description: "Logged to your timesheet." });
      }
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't save that", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "Add a time entry"}</DialogTitle>
          <DialogDescription>
            {entry
              ? "Update the project, times or details for this entry."
              : "Log time you forgot to track live — for today or any earlier day."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="entry-description">Description</Label>
            <Input
              id="entry-description"
              placeholder="What did you work on?"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={values.projectId}
                onValueChange={(projectId) => setValues((v) => ({ ...v, projectId }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  {recentProjects.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Recent</SelectLabel>
                      {recentProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            <ProjectDot color={p.color} />
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {recentProjects.length > 0 && otherProjects.length > 0 && <SelectSeparator />}
                  {otherProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <ProjectDot color={p.color} />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Task</Label>
              <Select
                value={values.task}
                onValueChange={(task) => setValues((v) => ({ ...v, task }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Task" />
                </SelectTrigger>
                <SelectContent>
                  {recentTasks.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Recent</SelectLabel>
                      {recentTasks.map((t) => (
                        <SelectItem key={t.id} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {recentTasks.length > 0 && otherTasks.length > 0 && <SelectSeparator />}
                  {otherTasks.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="entry-date">Date</Label>
              <Input
                id="entry-date"
                type="date"
                max={toDateKey(new Date())}
                value={values.date}
                onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entry-start">Start</Label>
              <Input
                id="entry-start"
                type="time"
                value={values.startTime}
                onChange={(e) => setValues((v) => ({ ...v, startTime: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entry-end">End</Label>
              <Input
                id="entry-end"
                type="time"
                value={values.endTime}
                onChange={(e) => setValues((v) => ({ ...v, endTime: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {entry ? "Save changes" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
