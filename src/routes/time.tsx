import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DescriptionAutocomplete } from "@/components/description-autocomplete";
import { EntryFormDialog } from "@/components/entry-form-dialog";
import { TimesheetGrid } from "@/components/timesheet-grid";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import {
  addDays,
  formatClock,
  formatDayLong,
  formatWeekRange,
  fromDateKey,
  oldestLoadedWeekStart,
  orderByRecency,
  orderByRecencyName,
  recentDescriptions,
  startOfWeek,
  toDateKey,
  weekdayNames,
} from "@/lib/time-utils";
import {
  useClientBudgets,
  useThisWeekStart,
  useWorkspace,
  type WorkspaceEntry,
} from "@/lib/workspace-store";

export const Route = createFileRoute("/time")({
  head: () => ({
    meta: [
      { title: "Time — IronTrack" },
      {
        name: "description",
        content:
          "Track time with a live timer and review your entries as a list, weekly grid or calendar.",
      },
      { property: "og:title", content: "Time — IronTrack" },
      {
        property: "og:description",
        content: "Live timer plus list, grid and calendar views of your tracked time.",
      },
    ],
  }),
  component: TimePage,
});

const pad = (n: number) => n.toString().padStart(2, "0");

/**
 * Select value for "start the timer without picking a project yet" —
 * Radix Select rejects an empty-string item value, hence the sentinel
 * instead of just using "". A project can always be added to the entry
 * later, same as the task.
 */
const NO_PROJECT = "__no_project__";

function TimePage() {
  const [view, setView] = useState("list");
  const [addOpen, setAddOpen] = useState(false);
  const { settings } = useWorkspace();

  return (
    <AppShell title="Time" subtitle="One place to start the clock and see where your hours went.">
      <TimerBar />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
          </TabsList>
        </Tabs>
        {settings.allowManualEntry && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add manual entry
          </Button>
        )}
      </div>
      <div className="mt-4">
        {view === "list" && <ListView />}
        {view === "grid" && <GridView />}
        {view === "calendar" && <CalendarView />}
      </div>
      <EntryFormDialog open={addOpen} onOpenChange={setAddOpen} entry={null} />
    </AppShell>
  );
}

function TimerBar() {
  const { projects, entries, runningEntry, startTimer, stopTimer, settings, taskCategories } =
    useWorkspace();
  const clientBudgets = useClientBudgets();
  const active = projects.filter((p) => !p.archived);
  const { recent: recentProjects, rest: otherProjects } = orderByRecency(active, entries);
  const [project, setProject] = useState("");
  // M25: empty taskCategoryIds means unrestricted (today's exact default)
  // — only a project deliberately scoped to specific categories narrows
  // the picker.
  const selectedProject = active.find((p) => p.id === project);
  const scopedTaskCategories =
    selectedProject && selectedProject.taskCategoryIds.length > 0
      ? taskCategories.filter((t) => selectedProject.taskCategoryIds.includes(t.id))
      : taskCategories;
  const { recent: recentTasks, rest: otherTasks } = orderByRecencyName(
    scopedTaskCategories,
    entries,
  );
  const [task, setTask] = useState("");
  const [description, setDescription] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project && active.length) setProject((recentProjects[0] ?? active[0]).id);
    // Only meant to pick a sensible starting project once, not re-run every
    // time entries/recency shifts under someone mid-selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, project]);

  useEffect(() => {
    // M32: mirrors the project field's default just above — most recently
    // used first, falling back to the first category only when there's no
    // entry history yet to derive a "recent" one from. Uses the
    // project-scoped list (M25) so the default respects a scoped
    // project's own task categories rather than the full global list.
    if (!task) setTask(recentTasks[0]?.name ?? scopedTaskCategories[0]?.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedTaskCategories, task]);

  useEffect(() => {
    if (!runningEntry) {
      setSeconds(0);
      return;
    }
    setProject(runningEntry.projectId ?? NO_PROJECT);
    setTask(runningEntry.task || taskCategories[0]?.name || "");
    setDescription(runningEntry.description);
    const tick = () =>
      setSeconds(
        Math.max(0, Math.floor((Date.now() - new Date(runningEntry.startTime).getTime()) / 1000)),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [runningEntry, taskCategories]);

  const running = !!runningEntry;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      if (runningEntry) {
        const result = await stopTimer(runningEntry.id, description);
        toast.success("Timer stopped", {
          description: result.splitAcrossDays
            ? "This ran past midnight, so it's been split into a separate entry for each day."
            : "Entry saved to your timesheet.",
        });
        setDescription("");
      } else {
        if (settings.requireDescriptions && !description.trim()) {
          toast.error("Add a description first", {
            description: "Your admin has made descriptions required.",
          });
          return;
        }
        const projectId = project && project !== NO_PROJECT ? project : null;
        await startTimer({ projectId, task, description });
        toast.success("Timer running", { description: "We'll keep counting until you stop." });
        // Non-blocking heads-up, not an enforcement rule — someone can
        // still track time against an over-budget client (that's a real
        // business decision, not something a timer button should decide),
        // this just makes sure it isn't invisible while it's happening.
        const startedProject = projects.find((p) => p.id === project);
        const budget = startedProject?.clientId
          ? clientBudgets.get(startedProject.clientId)
          : undefined;
        if (budget?.isOver) {
          toast.warning(`${startedProject!.client} has used all their subscription hours`, {
            description: `${formatHours(budget.renderedHours)} logged against a ${formatHours(budget.subscriptionHours)} allowance.`,
          });
        }
      }
    } catch (error) {
      toast.error("Timer failed", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }, [
    runningEntry,
    project,
    task,
    description,
    startTimer,
    stopTimer,
    settings.requireDescriptions,
    projects,
    clientBudgets,
  ]);

  // Space bar starts/stops the timer — as long as focus isn't in a text
  // field or on another interactive control (inputs, selects, buttons,
  // links), so typing a description or tabbing through the page still
  // behaves normally and the browser's own click-on-Space isn't double-fired.
  useEffect(() => {
    const isInteractiveTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A" ||
        el.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      if (!busy) void toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, busy]);

  // Warns once per threshold if a timer's been running an unusually long
  // time — almost always means someone forgot to stop it, not that they've
  // genuinely been on one task for 8+ hours straight. Based on wall-clock
  // elapsed time (not a per-second counter), so it correctly catches up and
  // fires immediately if the tab was closed or backgrounded past a
  // threshold, rather than only while actively watching the clock tick.
  const warnedThresholds = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!runningEntry) {
      warnedThresholds.current.clear();
      return;
    }
    const thresholdsHours = [4, 8, 12];
    for (const hours of thresholdsHours) {
      const thresholdSeconds = hours * 3600;
      if (seconds >= thresholdSeconds && !warnedThresholds.current.has(thresholdSeconds)) {
        warnedThresholds.current.add(thresholdSeconds);
        toast.warning(`Still running after ${hours} hour${hours > 1 ? "s" : ""}`, {
          description: "If you forgot to stop this timer, you can stop it now.",
          duration: 15000,
          action: { label: "Stop timer", onClick: () => void toggle() },
        });
      }
    }
  }, [seconds, runningEntry, toggle]);

  return (
    <Card className="sticky top-20 z-10 shadow-card">
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
        <DescriptionAutocomplete
          placeholder="What are you working on?"
          value={description}
          onChange={setDescription}
          suggestions={recentDescriptions(entries)}
          className="lg:flex-1"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[380px]">
          <div>
            <Select value={project} onValueChange={setProject} disabled={running}>
              <SelectTrigger>
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>No project</SelectItem>
                {(recentProjects.length > 0 || otherProjects.length > 0) && <SelectSeparator />}
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
            {/* L39: the dropdown itself always has "No project" so it's
                never literally empty, but with zero active projects
                there's nothing else to explain why — a first-day
                workspace hits this immediately. */}
            {active.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No projects yet — ask an admin to create one.
              </p>
            )}
          </div>
          <Select value={task} onValueChange={setTask} disabled={running}>
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
        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <div className="flex flex-col items-end gap-0.5">
            <span
              className="font-mono text-3xl font-semibold tabular-nums tracking-tight"
              style={{ color: running ? "var(--brand)" : undefined }}
            >
              {pad(h)}:{pad(m)}:{pad(s)}
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Press <kbd className="rounded border border-border px-1 py-0.5 font-sans">Space</kbd>{" "}
              to {running ? "stop" : "start"}
            </span>
          </div>
          <Button
            size="icon"
            variant={running ? "destructive" : "default"}
            aria-label={running ? "Stop timer" : "Start timer"}
            title={running ? "Stop timer (Space)" : "Start timer (Space)"}
            disabled={busy}
            onClick={() => void toggle()}
            className="h-12 w-12 rounded-full shadow-elevated transition-transform active:scale-95"
          >
            {running ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EntryList({ entries }: { entries: WorkspaceEntry[] }) {
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
                  {entry.running ? "running" : formatMinutes(entry.minutes)}
                </span>
                {locked ? (
                  <span
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground"
                    title="This week is locked — ask your manager to send it back to edit this entry"
                  >
                    <Lock className="h-4 w-4" />
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
                ? `"${deletingEntry.description || "No description"}" — ${formatMinutes(
                    deletingEntry.minutes,
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

function ListView() {
  const { entries } = useWorkspace();
  const days = useMemo(() => Array.from({ length: 4 }, (_, i) => addDays(new Date(), -i)), []);

  return (
    <div className="grid gap-6">
      {days.map((day, index) => {
        const key = toDateKey(day);
        const dayEntries = entries.filter((e) => e.date === key);
        if (index > 0 && dayEntries.length === 0) return null;
        return (
          <Card key={key} className="shadow-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">
                {index === 0 ? `Today · ${formatDayLong(day)}` : formatDayLong(day)}
              </CardTitle>
              <div className="flex items-center gap-3">
                {index === 0 && <CopyYesterdayButton />}
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatMinutes(dayEntries.reduce((s, e) => s + e.minutes, 0))}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <EntryList entries={dayEntries} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * M33: duplicates yesterday's entries onto today, preserving project/task/
 * description/duration — for the common case of a day that looks like the
 * one before it. Distinct from the single-entry ↻ Repeat action on each row
 * (which starts a *live timer*, not a completed duplicate) and from
 * startTimer's own project/task defaults, which only ever pick one thing at
 * a time. Reuses createEntry per entry rather than a new bulk mutation, so
 * the existing overlap/locked-week/manual-entry-disabled checks all still
 * apply per entry — a partial success (some entries copied, some skipped
 * because today already has something in that slot) is reported honestly
 * rather than treated as all-or-nothing.
 */
function CopyYesterdayButton() {
  const { entries, projectById, createEntry, settings } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [copying, setCopying] = useState(false);

  const yesterdayKey = toDateKey(addDays(new Date(), -1));
  // A still-running entry has no end time to copy — skip it rather than
  // guess at a duration.
  const yesterdayEntries = entries.filter((e) => e.date === yesterdayKey && !e.running);

  if (!settings.allowManualEntry || yesterdayEntries.length === 0) return null;

  const copy = async () => {
    setConfirming(false);
    setCopying(true);
    const todayKey = toDateKey(new Date());
    let succeeded = 0;
    let failed = 0;
    for (const e of yesterdayEntries) {
      const start = new Date(e.startTime);
      const end = e.endTime ? new Date(e.endTime) : start;
      try {
        await createEntry({
          projectId: e.projectId ?? "",
          task: e.task,
          description: e.description,
          date: todayKey,
          startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
          // M26: a copy should carry over whatever billable status
          // yesterday's entry actually had, not silently fall back to
          // the project's current default — a non-billable exception
          // (an internal sync, rework) stays non-billable when repeated.
          billable: e.billable,
        });
        succeeded++;
      } catch {
        failed++;
      }
    }
    setCopying(false);
    if (succeeded > 0) {
      toast.success(`Copied ${succeeded} ${succeeded === 1 ? "entry" : "entries"} from yesterday`, {
        description:
          failed > 0
            ? `${failed} couldn't be copied — probably overlapping something already logged today.`
            : "Logged to today.",
      });
    } else {
      toast.error("Couldn't copy yesterday's entries", {
        description: "They probably overlap with something already on today.",
      });
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={copying}
        onClick={() => setConfirming(true)}
      >
        <Copy className="h-3.5 w-3.5" />
        Copy yesterday ({yesterdayEntries.length})
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy yesterday's entries to today?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Adds {yesterdayEntries.length} {yesterdayEntries.length === 1 ? "entry" : "entries"}{" "}
                  to today with the same project, task, description and duration. Anything that
                  overlaps something already logged today is skipped, not overwritten.
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs">
                  {yesterdayEntries.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {projectById(e.projectId)?.name ?? "No project"} ·{" "}
                        {e.description || "No description"}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMinutes(e.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={copying}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={copying} onClick={() => void copy()}>
              Copy entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GridView() {
  const thisWeek = useThisWeekStart();
  const [offset, setOffset] = useState(0);
  const weekStart = useMemo(() => addDays(thisWeek, offset * 7), [thisWeek, offset]);
  // Entries are only ever fetched back to oldestLoadedWeekStart() — past
  // that, "no hours" would be a lie (unfetched, not empty), so navigation
  // stops here instead of silently rendering a blank week.
  const atOldestLoaded = weekStart <= oldestLoadedWeekStart();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          disabled={atOldestLoaded}
          onClick={() => setOffset((w) => w - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="truncate text-sm font-medium">{formatWeekRange(weekStart)}</span>
        <Button variant="outline" size="icon" onClick={() => setOffset((w) => Math.min(0, w + 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {atOldestLoaded && (
          <span className="text-xs text-muted-foreground">
            That's as far back as this view loads — check Reports for anything older.
          </span>
        )}
      </div>
      <TimesheetGrid weekStart={weekStart} />
    </div>
  );
}

function CalendarView() {
  const { entries, projectById } = useWorkspace();
  const [mode, setMode] = useState("month");
  // Independent per-mode offsets — switching Month/Week tabs shouldn't
  // jumble what "forward/back" meant in the other one.
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const today = useMemo(() => new Date(), []);

  const viewMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1),
    [today, monthOffset],
  );
  const weekStart = useMemo(
    () => addDays(startOfWeek(today), weekOffset * 7),
    [today, weekOffset],
  );

  const monthDays = useMemo(() => {
    const lead = (viewMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from(
        { length: daysInMonth },
        (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1),
      ),
    ];
  }, [viewMonth]);

  const weekDays = useMemo(() => weekdayNames.map((_, i) => addDays(weekStart, i)), [weekStart]);
  const cells = mode === "month" ? monthDays : weekDays;

  // Same rule Grid/Timesheet already use: entries are only ever fetched
  // back to oldestLoadedWeekStart(), so paging further back would silently
  // render a page that looks empty but just isn't loaded.
  const atOldestLoaded =
    mode === "month" ? viewMonth <= oldestLoadedWeekStart() : weekStart <= oldestLoadedWeekStart();
  const atNewest = mode === "month" ? monthOffset >= 0 : weekOffset >= 0;
  const isToday = mode === "month" ? monthOffset === 0 : weekOffset === 0;

  const goPrev = () =>
    mode === "month" ? setMonthOffset((o) => o - 1) : setWeekOffset((o) => o - 1);
  const goNext = () =>
    mode === "month"
      ? setMonthOffset((o) => Math.min(0, o + 1))
      : setWeekOffset((o) => Math.min(0, o + 1));
  const goToday = () => {
    setMonthOffset(0);
    setWeekOffset(0);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" disabled={atOldestLoaded} onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-sm font-medium">
            {mode === "month"
              ? viewMonth.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
              : `${formatWeekRange(weekStart)} ${weekStart.getFullYear()}`}
          </span>
          <Button variant="outline" size="icon" disabled={atNewest} onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
          )}
          {atOldestLoaded && (
            <span className="text-xs text-muted-foreground">
              That's as far back as this view loads — check Reports for anything older.
            </span>
          )}
        </div>
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card className="min-w-0 shadow-card">
        <CardContent className="overflow-x-auto p-4">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 gap-2 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {weekdayNames.map((d) => (
                <span key={d} className="px-1">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {cells.map((date, i) => {
                if (!date) return <div key={`blank-${i}`} className="min-h-24" />;
                const key = toDateKey(date);
                const dayEntries = entries.filter((e) => e.date === key);
                const totalHours = dayEntries.reduce((s, e) => s + e.minutes, 0) / 60;
                return (
                  <div
                    key={key}
                    className={
                      "flex flex-col gap-1 rounded-lg border border-border bg-card p-2 " +
                      (mode === "month" ? "min-h-24" : "min-h-64")
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium tabular-nums">{date.getDate()}</span>
                      {totalHours > 0 && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatHours(totalHours)}
                        </span>
                      )}
                    </div>
                    {dayEntries.map((e) => {
                      const p = projectById(e.projectId);
                      const color = p?.color ?? "var(--muted-foreground)";
                      return (
                        <div
                          key={e.id}
                          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium"
                          style={{
                            backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                            color,
                          }}
                          title={`${p?.name ?? "No project"} · ${e.description}`}
                        >
                          <ProjectDot color={color} />
                          <span className="truncate">
                            {mode === "month"
                              ? (p?.name ?? "No project")
                              : `${e.description || p?.name} · ${formatMinutes(e.minutes)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
