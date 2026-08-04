import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import { addDays, formatDayLong, toDateKey, weekdayNames } from "@/lib/time-utils";
import { useThisWeekStart, useWorkspace } from "@/lib/workspace-store";

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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Dashboard() {
  const { settings, currentUser, entries, projects, isAdmin, members } = useWorkspace();
  const weekStart = useThisWeekStart();
  const dailyGoal = settings.weeklyHours / 5;

  const pendingCount = isAdmin ? members.filter((m) => m.pending).length : 0;

  const todayKey = toDateKey(new Date());
  const todayEntries = entries.filter((e) => e.date === todayKey);
  const todayMinutes = todayEntries.reduce((sum, e) => sum + e.minutes, 0);

  const dayKeys = weekdayNames.map((_, i) => toDateKey(addDays(weekStart, i)));
  const weekEntries = entries.filter((e) => dayKeys.includes(e.date));
  const dayTotals = dayKeys.map(
    (key) => weekEntries.filter((e) => e.date === key).reduce((sum, e) => sum + e.minutes, 0) / 60,
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(...dayTotals, 0);
  const weekMinutes = weekEntries.reduce((s, e) => s + e.minutes, 0);
  const billableMinutes = weekEntries
    .filter((e) => projects.find((p) => p.id === e.projectId)?.billable)
    .reduce((s, e) => s + e.minutes, 0);
  const billableShare = weekMinutes ? Math.round((billableMinutes / weekMinutes) * 100) : 0;

  const topProjects = projects
    .map((p) => ({
      ...p,
      myWeekHours:
        weekEntries.filter((e) => e.projectId === p.id).reduce((s, e) => s + e.minutes, 0) / 60,
    }))
    .filter((p) => p.myWeekHours > 0)
    .sort((a, b) => b.myWeekHours - a.myWeekHours)
    .slice(0, 5);
  const maxProject = topProjects[0]?.myWeekHours ?? 1;
  const activeProjects = projects.filter((p) => !p.archived).length;

  return (
    <AppShell
      title={`${greeting()}${currentUser.name ? `, ${currentUser.name.split(" ")[0]}` : ""}`}
      subtitle={`${formatDayLong(new Date())} — here's how the week is shaping up.`}
      actions={
        <Button asChild className="gap-2">
          <Link to="/time">
            Go to Time <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      }
    >
      {pendingCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-50/50 shadow-card dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {pendingCount} {pendingCount === 1 ? "person" : "people"} waiting for approval
              </p>
              <p className="text-xs text-muted-foreground">
                They've signed in but can't access the dashboard until you approve them.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Review</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked today"
          value={formatMinutes(todayMinutes)}
          hint={`Goal ${formatHours(dailyGoal)} · ${todayEntries.length} entries`}
        />
        <StatCard label="This week" value={formatHours(weekTotal)} hint={`Across ${activeProjects} projects`} />
        <StatCard label="Daily average" value={formatHours(weekTotal / 5)} hint="Mon – Fri" />
        <StatCard label="Billable share" value={`${billableShare}%`} hint="Of hours logged this week" />
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
                  <span className="pt-2 text-xs text-muted-foreground">{weekdayNames[i]}</span>
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
            {topProjects.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing logged yet this week — start the timer on the Time page and this fills in.
              </p>
            )}
            {topProjects.map((p) => (
              <div key={p.id} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectDot color={p.color} />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatHours(p.myWeekHours)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${maxProject ? (p.myWeekHours / maxProject) * 100 : 0}%`,
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
