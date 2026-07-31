import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, Pause, Pencil, Play } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
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
import {
  formatMinutes,
  projectById,
  projects,
  tasks,
  todayEntries,
  type TimeEntry,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ironbrij Time" },
      { name: "description", content: "Track your day: start the timer, log entries, and see today's total tracked time across Ironbrij projects." },
      { property: "og:title", content: "Dashboard — Ironbrij Time" },
      { property: "og:description", content: "Start the timer and log time against Ironbrij projects." },
    ],
  }),
  component: Dashboard,
});

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function Dashboard() {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [project, setProject] = useState("p1");
  const [task, setTask] = useState(tasks[0]);
  const [description, setDescription] = useState("");
  const [entries, setEntries] = useState<TimeEntry[]>(todayEntries);
  const [editing, setEditing] = useState<string | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      interval.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, [running]);

  const stop = () => {
    if (seconds > 0) {
      setEntries((prev) => [
        {
          id: `local-${Date.now()}`,
          projectId: project,
          task,
          description: description || "Untitled entry",
          minutes: Math.max(1, Math.round(seconds / 60)),
          start: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          dayIndex: 3,
        },
        ...prev,
      ]);
    }
    setSeconds(0);
    setDescription("");
    setRunning(false);
  };

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0) + Math.floor(seconds / 60);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return (
    <AppShell title="Good morning, Maya" subtitle="Thursday, 12 June — let's make it count.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="shadow-card">
          <CardContent className="flex flex-col gap-6 p-6">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div
                className="font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl"
                style={{ color: running ? "var(--brand)" : undefined }}
              >
                {pad(h)}:{pad(m)}:{pad(s)}
              </div>
              <Button
                size="lg"
                onClick={() => (running ? stop() : setRunning(true))}
                className="h-20 w-20 rounded-full text-base shadow-elevated transition-transform active:scale-95"
                variant={running ? "destructive" : "default"}
              >
                {running ? (
                  <Pause className="h-7 w-7 fill-current" />
                ) : (
                  <Play className="h-7 w-7 fill-current" />
                )}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
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
            <Input
              placeholder="What are you working on?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tracked today</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{formatMinutes(totalMinutes)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Goal 7h 30m · {entries.length} entries</p>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">This week</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">28h 45m</p>
              <p className="mt-1 text-sm text-muted-foreground">Across 5 projects</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6 shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Today's entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nothing logged yet today — hit the big button above and we'll start counting.
            </p>
          ) : (
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
                      <ProjectDot color={p.color} />
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <Input
                            autoFocus
                            value={entry.description}
                            onChange={(e) =>
                              setEntries((prev) =>
                                prev.map((x) =>
                                  x.id === entry.id ? { ...x, description: e.target.value } : x,
                                ),
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
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
