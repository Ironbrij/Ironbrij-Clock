import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { TimesheetGrid } from "@/components/timesheet-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import { addDays, formatClock, formatWeekRange, toDateKey } from "@/lib/time-utils";
import { useThisWeekStart, useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/timesheet")({
  head: () => ({
    meta: [
      { title: "Timesheet — Ironbrij Time" },
      { name: "description", content: "Review your week in a project-by-day grid or a chronological list of logged time entries." },
      { property: "og:title", content: "Timesheet — Ironbrij Time" },
      { property: "og:description", content: "Weekly grid and list views of your tracked time." },
    ],
  }),
  component: Timesheet,
});

function Timesheet() {
  const [view, setView] = useState("grid");
  const [offset, setOffset] = useState(0);
  const thisWeek = useThisWeekStart();
  const weekStart = useMemo(() => addDays(thisWeek, offset * 7), [thisWeek, offset]);
  const { entries, projectById } = useWorkspace();

  const dayKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toDateKey(addDays(weekStart, i))),
    [weekStart],
  );
  const weekEntries = entries
    .filter((e) => dayKeys.includes(e.date))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const weekTotal = weekEntries.reduce((s, e) => s + e.minutes, 0) / 60;

  return (
    <AppShell title="Timesheet" subtitle="Everything you logged this week, in one place.">
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="truncate text-sm font-medium">{formatWeekRange(weekStart)}</span>
          <Button variant="outline" size="icon" onClick={() => setOffset((w) => Math.min(0, w + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">
            Total {formatHours(weekTotal)}
          </span>
        </div>
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "grid" ? (
        <TimesheetGrid weekStart={weekStart} />
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            {weekEntries.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">
                Nothing logged in this week yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {weekEntries.map((e) => {
                  const p = projectById(e.projectId);
                  const color = p?.color ?? "var(--muted-foreground)";
                  return (
                    <li
                      key={e.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <ProjectDot color={color} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{e.description || "No description"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p?.name ?? "No project"} · {e.task || "—"} · {formatClock(e.startTime)}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 tabular-nums text-sm font-medium">
                        {formatMinutes(e.minutes)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
