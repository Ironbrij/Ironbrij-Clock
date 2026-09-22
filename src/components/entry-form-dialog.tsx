import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ProjectDot } from "@/components/app-shell";
import { DescriptionAutocomplete } from "@/components/description-autocomplete";
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
import { CASUAL_SERVICE_CATEGORY_LABELS, type CasualServiceCategory } from "@/lib/workspace/types";

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
  const { projects, entries, createEntry, updateEntry, settings, taskCategories } = useWorkspace();
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
  // M46: seeded from the stored value (or null, for a new entry).
  // M48: now also auto-filled from the selected project's client, so it
  // follows the same touched-tracking shape as billable above — it keeps
  // following the client until the person picks a category themselves.
  const [serviceCategory, setServiceCategory] = useState<CasualServiceCategory | null>(null);
  const [serviceCategoryTouched, setServiceCategoryTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(entry, defaultTask));
      setEndsNextDay(false);
      setBillable(entry ? entry.billable : true);
      setBillableTouched(!!entry);
      setServiceCategory(entry ? entry.serviceCategory : null);
      setServiceCategoryTouched(!!entry);
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

  // M48: the last casual service category used for each client, so picking
  // a project can pre-fill the category the way Project and Task already
  // pre-fill from recency.
  //
  // Deliberately keyed on clients that have *actually* been categorised
  // before, and deliberately not a blanket "has a client → Paid Casual
  // Service": a non-null category is exactly what puts an entry into the
  // Casual Service report (casual-service-tab.tsx filters on it) and what
  // M46's client-inactivity flags are computed from. Defaulting it for
  // every client would sweep ordinary client work into the accounts team's
  // casual report. A client with no casual history stays null — "Not
  // casual service" — which is still the right default for most entries.
  //
  // Built from this person's own entries (the rolling window the workspace
  // already loads), so it reflects how *they* categorise their work for a
  // client, not someone else's convention.
  const lastCategoryByClient = useMemo(() => {
    const map = new Map<string, CasualServiceCategory>();
    const byRecency = [...entries].sort((a, b) => b.startTime.localeCompare(a.startTime));
    for (const e of byRecency) {
      if (!e.serviceCategory) continue;
      const clientId = projects.find((p) => p.id === e.projectId)?.clientId;
      // First hit wins — the list is newest-first, so that's the most
      // recent category for this client.
      if (!clientId || map.has(clientId)) continue;
      map.set(clientId, e.serviceCategory);
    }
    return map;
  }, [entries, projects]);

  // M48: same rule as billable just above — a new entry keeps following
  // the selected project's client until the category itself is touched;
  // editing an existing entry never recomputes, since its stored category
  // is a real value someone chose, not a default.
  useEffect(() => {
    if (!open || entry || serviceCategoryTouched) return;
    const clientId = projects.find((p) => p.id === values.projectId)?.clientId ?? null;
    setServiceCategory(clientId ? (lastCategoryByClient.get(clientId) ?? null) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.projectId, open, entry, serviceCategoryTouched, lastCategoryByClient]);

  // M25: empty taskCategoryIds means unrestricted (today's exact default)
  // — only a project deliberately scoped to specific categories narrows
  // the picker. Live against values.projectId, unlike defaultTask above.
  const selectedProject = active.find((p) => p.id === values.projectId);
  const scopedTaskCategories =
    selectedProject && selectedProject.taskCategoryIds.length > 0
      ? taskCategories.filter((t) => selectedProject.taskCategoryIds.includes(t.id))
      : taskCategories;
  const { recent: recentTasks, rest: otherTasks } = orderByRecencyName(
    scopedTaskCategories,
    entries,
  );

  const endDate = endsNextDay ? toDateKey(addDays(fromDateKey(values.date), 1)) : values.date;

  const submit = async () => {
    if (!values.projectId) {
      toast.error("Pick a project first");
      return;
    }
    if (!values.startTime || (!isRunning && !values.endTime)) {
      toast.error(isRunning ? "Add a start time" : "Add a start and end time");
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
        // billable/serviceCategory aren't part of the running-timer patch —
        // both controls are hidden in that case (only the start time is
        // correctable), so there's nothing to apply.
        await updateEntry(
          entry.id,
          isRunning ? { ...values, endTime: null } : { ...values, billable, serviceCategory },
        );
        toast.success("Entry updated");
      } else {
        await createEntry({
          ...values,
          endDate: endsNextDay ? endDate : undefined,
          billable,
          serviceCategory,
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
          description: `${formatHours(budget.renderedHours)} logged against a ${formatHours(budget.subscriptionHours)} allowance.`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(description) => setValues((v) => ({ ...v, description }))}
              suggestions={recentDescriptions(entries)}
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
                step="1"
                value={values.startTime}
                onChange={(e) => setValues((v) => ({ ...v, startTime: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="entry-end">End</Label>
              {isRunning ? (
                <div id="entry-end" className="flex h-9 items-center text-sm text-muted-foreground">
                  Still running
                </div>
              ) : (
                <Input
                  id="entry-end"
                  type="time"
                  step="1"
                  value={values.endTime}
                  onChange={(e) => setValues((v) => ({ ...v, endTime: e.target.value }))}
                />
              )}
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
          {/* M46: rare (only accounts-relevant casual work uses this), so it
              stays out of the way for the overwhelming majority of entries
              rather than adding an always-visible dropdown. */}
          {!isRunning && (
            <div className="grid gap-2">
              <Label htmlFor="entry-service-category" className="text-xs text-muted-foreground">
                Casual service category (optional)
              </Label>
              <Select
                value={serviceCategory ?? "none"}
                onValueChange={(v) => {
                  setServiceCategoryTouched(true);
                  setServiceCategory(v === "none" ? null : (v as CasualServiceCategory));
                }}
              >
                <SelectTrigger id="entry-service-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not casual service</SelectItem>
                  {(Object.keys(CASUAL_SERVICE_CATEGORY_LABELS) as CasualServiceCategory[]).map(
                    (category) => (
                      <SelectItem key={category} value={category}>
                        {CASUAL_SERVICE_CATEGORY_LABELS[category]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              {/* M48: says *why* a category appeared on its own, so a
                  pre-filled value reads as a suggestion to check rather
                  than something the person must have set themselves. Only
                  while it's still the auto-filled one — once touched, it's
                  their own choice and needs no explanation. */}
              {!entry && !serviceCategoryTouched && serviceCategory && selectedProject && (
                <p className="text-xs text-muted-foreground">
                  Carried over from the last casual service entry for {selectedProject.client}.
                  Change it here if this one's different.
                </p>
              )}
            </div>
          )}
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
