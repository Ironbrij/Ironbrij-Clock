import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { TimesheetGrid } from "@/components/timesheet-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatHours,
  formatMinutes,
  projectById,
  projects,
  weekEntries,
  weekGrid,
  weekdays,
} from "@/lib/mock-data";

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

const weekLabels = ["2 – 8 June", "9 – 15 June", "16 – 22 June"];

function Timesheet() {
  const [view, setView] = useState("grid");
  const [week, setWeek] = useState(1);

  const dayTotals = weekdays.map((_, i) =>
    projects.reduce((sum, p) => sum + (weekGrid[p.id]?.[i] ?? 0), 0),
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  return (
    <AppShell title="Timesheet" subtitle="Everything you logged this week, in one place.">
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeek((w) => Math.max(0, w - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="truncate text-sm font-medium">{weekLabels[week]}</span>
          <Button variant="outline" size="icon" onClick={() => setWeek((w) => Math.min(2, w + 1))}>
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
        <TimesheetGrid />
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {weekEntries.map((e) => {
                const p = projectById(e.projectId);
                return (
                  <li
                    key={e.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5 hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ProjectDot color={p.color} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.description}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.name} · {e.task} · {e.start}
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
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}