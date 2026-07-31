import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
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
        <Card className="overflow-hidden shadow-card">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Project</th>
                  {weekdays.map((d) => (
                    <th key={d} className="px-3 py-3 text-center font-medium">{d}</th>
                  ))}
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const row = weekGrid[p.id] ?? [];
                  const total = row.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          <ProjectDot color={p.color} />
                          <span className="truncate font-medium">{p.name}</span>
                        </span>
                      </td>
                      {row.map((hours, i) => (
                        <td
                          key={i}
                          className={
                            "px-3 py-3 text-center tabular-nums " +
                            (hours ? "text-foreground" : "text-muted-foreground/40")
                          }
                        >
                          {hours ? hours.toFixed(2) : "—"}
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right font-medium tabular-nums">
                        {formatHours(total)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/50 text-sm font-medium">
                  <td className="px-5 py-3">Daily total</td>
                  {dayTotals.map((t, i) => (
                    <td key={i} className="px-3 py-3 text-center tabular-nums">{t.toFixed(2)}</td>
                  ))}
                  <td className="px-5 py-3 text-right tabular-nums">{formatHours(weekTotal)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
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