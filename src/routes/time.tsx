import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pause, Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { TimesheetGrid } from "@/components/timesheet-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours, formatMinutes, tasks } from "@/lib/mock-data";
import {
  addDays,
  formatClock,
  formatDayLong,
  formatWeekRange,
  startOfWeek,
  toDateKey,
  weekdayNames,
} from "@/lib/time-utils";
import { useThisWeekStart, useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";

export const Route = createFileRoute("/time")({
  head: () => ({
    meta: [
      { title: "Time — Ironbrij Time" },
      {
        name: "description",
        content:
          "Track time with a live timer and review your entries as a list, weekly grid or calendar.",
      },
      { property: "og:title", content: "Time — Ironbrij Time" },
      { property: "og:description", content: "Live timer plus list, grid and calendar views of your tracked time." },
    ],
  }),
  component: TimePage,
});

const pad = (n: number) => n.toString().padStart(2, "0");

function TimePage() {
  const [view, setView] = useState("list");

  return (
    <AppShell title="Time" subtitle="One place to start the clock and see where your hours went.">
      <TimerBar />
      <Tabs value={view} onValueChange={setView} className="mt-6">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="grid">Grid</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4">
        {view === "list" && <ListView />}
        {view === "grid" && <GridView />}
        {view === "calendar" && <CalendarView />}
      </div>
    </AppShell>
  );
}

function TimerBar() {
  const { projects, runningEntry, startTimer, stopTimer } = useWorkspace();
  const active = projects.filter((p) => !p.archived);
  const [project, setProject] = useState("");
  const [task, setTask] = useState(tasks[0]);
  const [description, setDescription] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project && active[0]) setProject(active[0].id);
  }, [active, project]);

  useEffect(() => {
    if (!runningEntry) {
      setSeconds(0);
      return;
    }
    setProject(runningEntry.projectId ?? "");
    setTask(runningEntry.task || tasks[0]);
    setDescription(runningEntry.description);
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(runningEntry.startTime).getTime()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [runningEntry]);

  const running = !!runningEntry;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const toggle = async () => {
    setBusy(true);
    try {
      if (runningEntry) {
        await stopTimer(runningEntry.id);
        toast.success("Timer stopped", { description: "Entry saved to your timesheet." });
        setDescription("");
      } else {
        if (!project) {
          toast.error("Pick a project first");
          return;
        }
        await startTimer({ projectId: project, task, description });
        toast.success("Timer running", { description: "We'll keep counting until you stop." });
      }
    } catch (error) {
      toast.error("Timer failed", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="sticky top-20 z-10 shadow-card">
      <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
        <Input
          placeholder="What are you working on?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="lg:flex-1"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:w-[380px]">
          <Select value={project} onValueChange={setProject} disabled={running}>
            <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              {active.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <ProjectDot color={p.color} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={task} onValueChange={setTask} disabled={running}>
            <SelectTrigger><SelectValue placeholder="Task" /></SelectTrigger>
            <SelectContent>
              {tasks.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <span
            className="font-mono text-3xl font-semibold tabular-nums tracking-tight"
            style={{ color: running ? "var(--brand)" : undefined }}
          >
            {pad(h)}:{pad(m)}:{pad(s)}
          </span>
          <Button
            size="icon"
            variant={running ? "destructive" : "default"}
            aria-label={running ? "Stop timer" : "Start timer"}
            disabled={busy}
            onClick={() => void toggle()}
            className="h-12 w-12 rounded-full shadow-elevated transition-transform active:scale-95"
          >
            {running ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EntryList({ entries }: { entries: WorkspaceEntry[] }) {
  const { projectById, updateEntry } = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (entries.length === 0) {
    return <p className="px-6 py-6 text-sm text-muted-foreground">No time logged on this day.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {entries.map((entry) => {
        const p = projectById(entry.projectId);
        const isEditing = editing === entry.id;
        return (
          <li
            key={entry.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ProjectDot color={p?.color ?? "var(--muted-foreground)"} />
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      setEditing(null);
                      if (draft !== entry.description) {
                        updateEntry(entry.id, { description: draft }).catch((error: Error) =>
                          toast.error("Couldn't save that", { description: error.message }),
                        );
                      }
                    }}
                    className="h-8"
                  />
                ) : (
                  <p className="truncate text-sm font-medium">
                    {entry.description || "No description"}
                  </p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {p?.name ?? "No project"} · {entry.task || "—"} · from {formatClock(entry.startTime)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="tabular-nums text-sm font-medium">
                {entry.running ? "running" : formatMinutes(entry.minutes)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit entry"
                onClick={() => {
                  if (isEditing) setEditing(null);
                  else {
                    setDraft(entry.description);
                    setEditing(entry.id);
                  }
                }}
              >
                {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
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
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatMinutes(dayEntries.reduce((s, e) => s + e.minutes, 0))}
              </span>
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

function GridView() {
  const thisWeek = useThisWeekStart();
  const [offset, setOffset] = useState(0);
  const weekStart = useMemo(() => addDays(thisWeek, offset * 7), [thisWeek, offset]);

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setOffset((w) => w - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="truncate text-sm font-medium">{formatWeekRange(weekStart)}</span>
        <Button variant="outline" size="icon" onClick={() => setOffset((w) => Math.min(0, w + 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <TimesheetGrid weekStart={weekStart} />
    </div>
  );
}

function CalendarView() {
  const { entries, projectById } = useWorkspace();
  const [mode, setMode] = useState("month");
  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);

  const monthDays = useMemo(() => {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(today.getFullYear(), today.getMonth(), i + 1)),
    ];
  }, [today]);

  const weekDays = useMemo(() => weekdayNames.map((_, i) => addDays(weekStart, i)), [weekStart]);
  const cells = mode === "month" ? monthDays : weekDays;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          {mode === "month"
            ? today.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
            : `${formatWeekRange(weekStart)} ${weekStart.getFullYear()}`}
        </span>
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-4">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 gap-2 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {weekdayNames.map((d) => (
                <span key={d} className="px-1">{d}</span>
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
