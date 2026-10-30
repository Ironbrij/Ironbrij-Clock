import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProjectDot } from "@/components/app-shell";
import { DescriptionAutocomplete } from "@/components/description-autocomplete";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  addDays,
  formatDayLong,
  fromDateKey,
  orderByRecency,
  orderByRecencyName,
  recentDescriptions,
  toDateKey,
} from "@/lib/time-utils";
import { formatHours } from "@/lib/mock-data";
import { useClientBudgets, useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";
import { serviceCategoryForTags } from "@/lib/service-category";
import { CASUAL_SERVICE_CATEGORY_LABELS } from "@/lib/workspace/types";

const pad = (n: number) => n.toString().padStart(2, "0");

type EntryField = "description" | "project" | "start" | "end";
/** Page order, so focus lands on the topmost invalid field. */
const entryFieldOrder: EntryField[] = ["description", "project", "start", "end"];
const entryFieldIds: Record<EntryField, string> = {
  description: "entry-description",
  project: "entry-project",
  start: "entry-start",
  end: "entry-end",
};

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
    startTime: clockValue(start),
    endTime: clockValue(end),
  };
}

/**
 * M51: `HH:MM`, or `HH:MM:SS` when the entry actually lands mid-minute.
 *
 * A timer-tracked entry almost always does, and `<input type="time">` keeps
 * whatever precision its value carries — so without this, opening the edit
 * dialog on a 3h29m30s entry and saving anything at all (even just a typo
 * in the description) would round it to 3h29m and permanently discard the
 * seconds. A manual entry typed on the minute still renders as plain
 * `HH:MM`, so the common case looks exactly as it did.
 */
function clockValue(d: Date) {
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getSeconds() === 0 ? hm : `${hm}:${pad(d.getSeconds())}`;
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
  const { projects, entries, createEntry, updateEntry, settings, taskCategories, tags } =
    useWorkspace();
  const clientBudgets = useClientBudgets();
  // A running entry has no end yet — this dialog only lets it be reached
  // for that case to correct the start (see updateEntry's `endTime: null`
  // branch), the only edit a still-running timer supports.
  const isRunning = !!entry?.running;
  const active = projects.filter((p) => !p.archived);
  const { recent: recentProjects, rest: otherProjects } = orderByRecency(active, entries);
  // M32: matches the project field's default (most recently used first).
  // M25: taskCategories here is only used for this initial default, before
  // a project has necessarily even been picked yet for a brand-new entry
  // — the live Task field's own options are scoped separately below, once
  // values.projectId is known.
  const defaultTask =
    orderByRecencyName(taskCategories, entries).recent[0]?.name ?? taskCategories[0]?.name ?? "";
  const [values, setValues] = useState<EntryFormValues>(() => toFormValues(entry, defaultTask));
  const [busy, setBusy] = useState(false);
  // M21: only meaningful for "add" (entry === null) — a stored entry never
  // actually spans midnight (createEntry/stopTimer already split it at the
  // day boundary before it's saved), so there's nothing to toggle back on
  // when editing one.
  const [endsNextDay, setEndsNextDay] = useState(false);
  // M26: billable defaults to the selected project's own setting and keeps
  // following it as the project changes, until the person explicitly
  // touches the checkbox once — then it's a fixed override for this entry,
  // same as the stored value an existing entry already has.
  const [billable, setBillable] = useState(true);
  const [billableTouched, setBillableTouched] = useState(false);
  // What the form looked like when it opened — the baseline for "has the
  // person changed anything?" (see `dirty` below).
  const [initialValues, setInitialValues] = useState<EntryFormValues>(values);
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useEffect(() => {
    if (open) {
      const initial = toFormValues(entry, defaultTask);
      setValues(initial);
      setInitialValues(initial);
      setErrors({});
      setConfirmingDiscard(false);
      setEndsNextDay(false);
      setBillable(entry ? entry.billable : true);
      setBillableTouched(!!entry);
    }
    // defaultTask intentionally excluded — it should only affect the
    // initial value when the dialog opens, not overwrite whatever the
    // person has already picked while it's sitting open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry]);

  // Adding a new entry: keep following the selected project's billable
  // default until the checkbox itself has been touched. Editing an
  // existing one: entry.billable is a real stored value from the moment
  // the dialog opens, not a "default" to keep recomputing.
  useEffect(() => {
    if (!open || entry || billableTouched) return;
    const project = projects.find((p) => p.id === values.projectId);
    setBillable(project?.billable ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.projectId, open, entry, billableTouched]);

  // M25: empty taskCategoryIds means unrestricted (today's exact default)
  // — only a project deliberately scoped to specific categories narrows
  // the picker. Live against values.projectId, unlike defaultTask above.
  const selectedProject = active.find((p) => p.id === values.projectId);
  // The category comes from the project's tag (20261016000000), never from
  // this form — shown so the person can see how the work will be billed.
  const projectCategory = selectedProject
    ? serviceCategoryForTags(selectedProject.tagIds, tags)
    : null;
  const scopedTaskCategories =
    selectedProject && selectedProject.taskCategoryIds.length > 0
      ? taskCategories.filter((t) => selectedProject.taskCategoryIds.includes(t.id))
      : taskCategories;
  const { recent: recentTasks, rest: otherTasks } = orderByRecencyName(
    scopedTaskCategories,
    entries,
  );

  const endDate = endsNextDay ? toDateKey(addDays(fromDateKey(values.date), 1)) : values.date;

  // Has the person changed anything since the dialog opened? Billable auto-follows
  // the project on a new entry, so for "add" it only counts once deliberately
  // touched; for "edit" it is compared with the stored entry.
  const dirty =
    JSON.stringify(values) !== JSON.stringify(initialValues) ||
    endsNextDay ||
    (entry ? !isRunning && billable !== entry.billable : billableTouched);

  // Every way of dismissing the dialog (Esc, outside click, X, Cancel) goes
  // through here, so typed-in work is never thrown away without asking. A
  // successful save calls onOpenChange directly and skips this.
  const requestOpenChange = (next: boolean) => {
    if (!next && dirty && !busy) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  const setField = <K extends keyof EntryFormValues>(field: K, value: EntryFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    const errorKey: EntryField | null =
      field === "projectId"
        ? "project"
        : field === "startTime"
          ? "start"
          : field === "endTime"
            ? "end"
            : field === "description"
              ? "description"
              : null;
    if (errorKey) setErrors((prev) => (prev[errorKey] ? { ...prev, [errorKey]: undefined } : prev));
  };

  const errorProps = (field: EntryField) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${entryFieldIds[field]}-error` : undefined,
  });
  const fieldError = (field: EntryField) =>
    errors[field] ? (
      <p id={`${entryFieldIds[field]}-error`} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  const submit = async () => {
    // Inline, per-field validation: each message sits under its field and is
    // announced via aria-describedby, and focus moves to the first invalid
    // field in page order.
    const next: Partial<Record<EntryField, string>> = {};
    if (settings.requireDescriptions && !values.description.trim()) {
      next.description = "Add a description — your admin has made them required.";
    }
    if (!values.projectId) next.project = "Pick a project.";
    if (!values.startTime) {
      next.start = isRunning ? "Add the time this timer started." : "Add a start time.";
    }
    if (!isRunning && !values.endTime) next.end = "Add an end time.";
    setErrors(next);
    const firstInvalid = entryFieldOrder.find((field) => next[field]);
    if (firstInvalid) {
      document.getElementById(entryFieldIds[firstInvalid])?.focus();
      return;
    }
    setBusy(true);
    try {
      if (entry) {
        // billable isn't part of the running-timer patch —
        // the control is hidden in that case (only the start time is
        // correctable), so there's nothing to apply.
        await updateEntry(
          entry.id,
          isRunning ? { ...values, endTime: null } : { ...values, billable },
        );
        toast.success("Entry updated");
      } else {
        await createEntry({
          ...values,
          endDate: endsNextDay ? endDate : undefined,
          billable,
        });
        toast.success("Entry added", { description: "Logged to your timesheet." });
      }
      // Non-blocking heads-up, same as TimerBar's — the entry is already
      // saved either way, this just surfaces that its client has no
      // subscription hours left instead of that being invisible.
      const savedProject = projects.find((p) => p.id === values.projectId);
      const budget = savedProject?.clientId ? clientBudgets.get(savedProject.clientId) : undefined;
      if (budget?.isOver) {
        toast.warning(`${savedProject!.client} has used all their subscription hours`, {
          description: `${formatHours(budget.renderedHours)} used of a ${formatHours(budget.subscriptionHours)} allowance.`,
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't save that", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "Add a time entry"}</DialogTitle>
          <DialogDescription>
            {isRunning
              ? "This timer is still running — you can only correct when it started."
              : entry
                ? "Update the project, times or details for this entry."
                : "Log time you forgot to track live — for today or any earlier day."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="entry-description">Description</Label>
            <DescriptionAutocomplete
              id="entry-description"
              placeholder="What did you work on?"
              value={values.description}
              onChange={(description) => setField("description", description)}
              suggestions={recentDescriptions(entries)}
              {...errorProps("description")}
            />
            {fieldError("description")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="entry-project">Project</Label>
              <Select
                value={values.projectId}
                onValueChange={(projectId) => setField("projectId", projectId)}
              >
                <SelectTrigger id="entry-project" {...errorProps("project")}>
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
              {fieldError("project")}
              {/* L39: this picker has no fallback item (a manual entry needs
                  a real project, unlike the timer's "No project" option) —
                  with zero active projects it's a genuinely empty dropdown
                  that only explained itself on submit before this. */}
              {active.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No projects yet — ask an admin to create one.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entry-task">Task</Label>
              <Select
                value={values.task}
                onValueChange={(task) => setValues((v) => ({ ...v, task }))}
              >
                <SelectTrigger id="entry-task">
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
                step="1"
                value={values.startTime}
                onChange={(e) => setField("startTime", e.target.value)}
                {...errorProps("start")}
              />
              {fieldError("start")}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={isRunning ? undefined : "entry-end"}>End</Label>
              {isRunning ? (
                <div className="flex h-9 items-center text-sm text-muted-foreground">
                  Still running
                </div>
              ) : (
                <Input
                  id="entry-end"
                  type="time"
                  step="1"
                  value={values.endTime}
                  onChange={(e) => setField("endTime", e.target.value)}
                  {...errorProps("end")}
                />
              )}
              {fieldError("end")}
            </div>
          </div>
          {!entry && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="entry-ends-next-day"
                checked={endsNextDay}
                onCheckedChange={(checked) => setEndsNextDay(checked === true)}
              />
              <Label htmlFor="entry-ends-next-day" className="cursor-pointer font-normal">
                Ends after midnight, the next day
                {endsNextDay && ` — ${formatDayLong(fromDateKey(endDate))}`}
              </Label>
            </div>
          )}
          {/* M26: hidden for a running entry — that case only supports
              correcting the start time, same as every other field but
              startTime/date above. */}
          {!isRunning && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="entry-billable"
                checked={billable}
                onCheckedChange={(checked) => {
                  setBillableTouched(true);
                  setBillable(checked === true);
                }}
              />
              <Label htmlFor="entry-billable" className="cursor-pointer font-normal">
                Billable
              </Label>
            </div>
          )}
          {entry && (entry.serviceCategory ?? null) !== projectCategory ? (
            <p className="text-xs text-muted-foreground">
              {entry.serviceCategory
                ? `Casual service: ${CASUAL_SERVICE_CATEGORY_LABELS[entry.serviceCategory]} on this entry. Its project's tag now says ${
                    projectCategory ? CASUAL_SERVICE_CATEGORY_LABELS[projectCategory] : "none"
                  }.`
                : `This entry has no casual service category. Its project's tag now says ${
                    projectCategory ? CASUAL_SERVICE_CATEGORY_LABELS[projectCategory] : "none"
                  }.`}
            </p>
          ) : (
            projectCategory && (
              <p className="text-xs text-muted-foreground">
                Casual service: {CASUAL_SERVICE_CATEGORY_LABELS[projectCategory]}, set by the
                project's tag.
              </p>
            )
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => requestOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : entry ? "Save changes" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {entry
                ? "Your edits to this entry haven't been saved."
                : "This entry hasn't been added yet."}{" "}
              If you close now, what you've typed will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingDiscard(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
