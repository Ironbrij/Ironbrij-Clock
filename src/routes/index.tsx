import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatHours,
  formatMinutes,
  projects,
  todayEntries,
  weekGrid,
  weekdays,
} from "@/lib/mock-data";
import { useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ironbrij Time" },
      { name: "description", content: "Your Ironbrij overview: hours tracked today and this week, daily breakdown and top projects." },
      { property: "og:title", content: "Dashboard — Ironbrij Time" },
      { property: "og:description", content: "Hours tracked today and this week across Ironbrij projects." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { settings } = useWorkspace();
  const dailyGoal = settings.weeklyHours / 5;
  const todayMinutes = todayEntries.reduce((sum, e) => sum + e.minutes, 0);
  const dayTotals = weekdays.map((_, i) =>
    projects.reduce((sum, p) => sum + (weekGrid[p.id]?.[i] ?? 0), 0),
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...dayTotals);
  const topProjects = [...projects]
    .map((p) => ({ ...p, weekHours: (weekGrid[p.id] ?? []).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.weekHours - a.weekHours)
    .slice(0, 5);
  const maxProject = topProjects[0]?.weekHours ?? 1;

  return (
    <AppShell
      title="Good morning, Maya"
      subtitle="Thursday, 12 June — here's how the week is shaping up."
      actions={
        <Button asChild className="gap-2">
          <Link to="/time">
            Go to Time <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked today"
          value={formatMinutes(todayMinutes)}
          hint={`Goal ${formatHours(dailyGoal)} · ${todayEntries.length} entries`}
        />
        <StatCard label="This week" value={formatHours(weekTotal)} hint="Across 6 projects" />
        <StatCard label="Daily average" value={formatHours(weekTotal / 5)} hint="Mon – Fri" />
        <StatCard label="Billable share" value="82%" hint="Of hours logged this week" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Hours by day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 items-stretch gap-3">
              {dayTotals.map((t, i) => (
                <div key={i} className="flex h-full flex-1 flex-col items-center">
                  <div className="flex h-full w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-primary/85"
                      style={{ height: `${maxDay ? Math.max((t / maxDay) * 100, t > 0 ? 4 : 0) : 0}%` }}
                    />
                  </div>
                  <span className="pt-2 text-xs text-muted-foreground">{weekdays[i]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Top projects this week</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {topProjects.map((p) => (
              <div key={p.id} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectDot color={p.color} />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatHours(p.weekHours)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${maxProject ? (p.weekHours / maxProject) * 100 : 0}%`,
                      backgroundColor: p.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
