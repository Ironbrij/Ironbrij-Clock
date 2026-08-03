import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pause, Pencil, Play } from "lucide-react";
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
import {
  formatHours,
  formatMinutes,
  projectById,
  projects,
  tasks,
  todayEntries,
  weekEntries,
  weekdays,
  type TimeEntry,
} from "@/lib/mock-data";

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
const weekLabels = ["2 – 8 June", "9 – 15 June", "16 – 22 June"];

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
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [project, setProject] = useState("p1");
  const [task, setTask] = useState(tasks[0]);
  const [description, setDescription] = useState("");
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      interval.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, [running]);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

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
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <ProjectDot color={p.color} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={task} onValueChange={setTask}>
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
            onClick={() => {
              if (running) {
                setSeconds(0);
                setDescription("");
              }
              setRunning((r) => !r);
            }}
            className="h-12 w-12 rounded-full shadow-elevated transition-transform active:scale-95"
          >
            {running ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EntryList({ entries }: { entries: TimeEntry[] }) {
  const [rows, setRows] = useState(entries);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-border">
      {rows.map((entry) => {
        const p = projectById(entry.projectId);
        const isEditing = editing === entry.id;
        return (
          <li
            key={entry.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ProjectDot color={p.color} />
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <Input
                    autoFocus
                    value={entry.description}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) => (x.id === entry.id ? { ...x, description: e.target.value } : x)),
                      )
                    }
                    onBlur={() => setEditing(null)}
                    className="h-8"
                  />
                ) : (
                  <p className="truncate text-sm font-medium">{entry.description}</p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {p.name} · {entry.task} · from {entry.start}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="tabular-nums text-sm font-medium">{formatMinutes(entry.minutes)}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit entry"
                onClick={() => setEditing(isEditing ? null : entry.id)}
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
  const previousDays = [2, 1, 0].map((dayIndex) => ({
    dayIndex,
    entries: weekEntries.filter((e) => e.dayIndex === dayIndex),
  }));
  const dayNames = ["Monday 9 June", "Tuesday 10 June", "Wednesday 11 June"];

  return (
    <div className="grid gap-6">
      <Card className="shadow-card">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Today · Thursday 12 June</CardTitle>
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatMinutes(todayEntries.reduce((s, e) => s + e.minutes, 0))}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <EntryList entries={todayEntries} />
        </CardContent>
      </Card>

      {previousDays.map(({ dayIndex, entries }) => (
        <Card key={dayIndex} className="shadow-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{dayNames[dayIndex]}</CardTitle>
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatMinutes(entries.reduce((s, e) => s + e.minutes, 0))}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <EntryList entries={entries} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function GridView() {
  const [week, setWeek] = useState(1);
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setWeek((w) => Math.max(0, w - 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="truncate text-sm font-medium">{weekLabels[week]}</span>
        <Button variant="outline" size="icon" onClick={() => setWeek((w) => Math.min(2, w + 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <TimesheetGrid />
    </div>
  );
}

function CalendarView() {
  const [mode, setMode] = useState("month");

  // June 2026 starts on a Monday, 30 days.
  const days = Array.from({ length: 30 }, (_, i) => i + 1);
  const entriesForDay = (day: number) => {
    const weekdayIndex = (day - 1) % 7;
    return weekEntries.filter((e) => e.dayIndex === weekdayIndex);
  };

  const weekDays = [9, 10, 11, 12, 13, 14, 15];

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">{mode === "month" ? "June 2026" : "9 – 15 June 2026"}</span>
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
              {weekdays.map((d) => (
                <span key={d} className="px-1">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {(mode === "month" ? days : weekDays).map((day) => {
                const dayEntries = entriesForDay(day);
                const totalHours = dayEntries.reduce((s, e) => s + e.minutes, 0) / 60;
                return (
                  <div
                    key={day}
                    className={
                      "flex flex-col gap-1 rounded-lg border border-border bg-card p-2 " +
                      (mode === "month" ? "min-h-24" : "min-h-64")
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium tabular-nums">{day}</span>
                      {totalHours > 0 && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatHours(totalHours)}
                        </span>
                      )}
                    </div>
                    {dayEntries.map((e) => {
                      const p = projectById(e.projectId);
                      return (
                        <div
                          key={`${day}-${e.id}`}
                          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium"
                          style={{
                            backgroundColor: `color-mix(in oklab, ${p.color} 14%, transparent)`,
                            color: p.color,
                          }}
                          title={`${p.name} · ${e.description}`}
                        >
                          <ProjectDot color={p.color} />
                          <span className="truncate">
                            {mode === "month" ? p.name : `${e.description} · ${formatMinutes(e.minutes)}`}
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