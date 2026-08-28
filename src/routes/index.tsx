import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, CheckCheck, Clock, Info, Megaphone, Users, X } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import {
  addDays,
  formatDayLong,
  formatWeekRange,
  fromDateKey,
  startOfWeek,
  toDateKey,
  weekdayNames,
} from "@/lib/time-utils";
import { useThisWeekStart, useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — IronTrack" },
      {
        name: "description",
        content:
          "Your Ironbrij overview: hours tracked today and this week, daily breakdown and top projects.",
      },
      { property: "og:title", content: "Dashboard — IronTrack" },
      {
        property: "og:description",
        content: "Hours tracked today and this week across Ironbrij projects.",
      },
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

/**
 * M30: local weekday/hour in a specific IANA timezone, without a new
 * dependency — Intl.DateTimeFormat already supports this natively. Used
 * for the "nothing logged this week" nudge below, which needs the
 * *person's own* stored timezone (profiles.timezone), not the browser's,
 * since a Sydney-based admin viewing a Manila-based member's data would
 * otherwise get the wrong day/hour for that check (not that this check
 * runs on anyone but the signed-in viewer today, but getting the
 * timezone source right now avoids that bug appearing later).
 */
function nowInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return { weekday, hour };
}

function Dashboard() {
  const {
    settings,
    currentUser,
    entries,
    projects,
    isAdmin,
    activeMembers,
    timesheetForWeek,
    canManage,
    pendingApprovals,
    unseenAnnouncementCount,
  } = useWorkspace();
  const weekStart = useThisWeekStart();
  const dailyGoal = settings.weeklyHours / 5;
  const [unsubmittedDismissed, setUnsubmittedDismissed] = useState(false);
  const [weekNudgeDismissed, setWeekNudgeDismissed] = useState(false);

  const pendingCount = isAdmin ? activeMembers.filter((m) => m.pending).length : 0;
  // H22: same shape as the pending-signups banner below, for the other
  // "waiting on a manager/admin" queue — pendingApprovals is already
  // RLS-scoped to what this viewer can review.
  const pendingApprovalCount = canManage ? pendingApprovals.length : 0;

  // H19: nudges the person who actually needs to act — Manage > Approvals
  // already shows a manager which of their team hasn't submitted this
  // week, but nothing surfaced *past* weeks with logged-but-unsubmitted
  // time to the employee themselves. A week with zero entries is never
  // included: submit_timesheet() already rejects an empty week server-side
  // (M22), so "has entries" alone is enough to exclude genuine time off
  // without needing a real leave calendar.
  const pastWeekKeys = Array.from(
    new Set(
      entries
        .map((e) => toDateKey(startOfWeek(fromDateKey(e.date))))
        .filter((key) => fromDateKey(key) < weekStart),
    ),
  );
  const unsubmittedPastWeeks = pastWeekKeys
    .map((key) => {
      const start = fromDateKey(key);
      return { weekStart: start, status: timesheetForWeek(start)?.status };
    })
    .filter((w) => w.status !== "Submitted" && w.status !== "Approved")
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());

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

  // M30, narrow version: a daily "nothing logged today" check would false-
  // positive on every weekend/holiday/day off, since there's no real leave
  // calendar yet to tell those apart from forgetfulness (Time Off is still
  // mock data — see the parity audit's M24). Checking once, Friday
  // afternoon, for a week with literally nothing logged at all is far less
  // likely to be wrong while still catching the real "the whole week got
  // away from me" case. Uses the person's own stored timezone, not the
  // browser's.
  const { weekday: localWeekday, hour: localHour } = nowInTimezone(currentUser.timezone);
  const showWeekNudge =
    !weekNudgeDismissed && localWeekday === "Fri" && localHour >= 14 && weekEntries.length === 0;

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

  // L33: a quick glance back at the week that just ended — right when
  // someone's deciding whether it's ready to submit, without needing to go
  // find it on the Timesheet page first. Reuses the same aggregation as
  // "This week" above, just pointed at the prior week.
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeekKeys = weekdayNames.map((_, i) => toDateKey(addDays(lastWeekStart, i)));
  const lastWeekEntries = entries.filter((e) => lastWeekKeys.includes(e.date));
  const lastWeekMinutes = lastWeekEntries.reduce((s, e) => s + e.minutes, 0);
  const lastWeekProjectCount = new Set(
    lastWeekEntries.map((e) => e.projectId).filter((id): id is string => !!id),
  ).size;
  const lastWeekStatus = timesheetForWeek(lastWeekStart)?.status;
  const lastWeekBadgeVariant =
    lastWeekStatus === "Approved"
      ? "default"
      : lastWeekStatus === "Submitted"
        ? "secondary"
        : lastWeekStatus === "Rejected"
          ? "destructive"
          : "outline";

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
      {pendingApprovalCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-50/50 shadow-card dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <CheckCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {pendingApprovalCount} {pendingApprovalCount === 1 ? "timesheet" : "timesheets"}{" "}
                waiting on your review
              </p>
              <p className="text-xs text-muted-foreground">
                Submitted and ready for approval — nothing else needed from the employee.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/manage" search={{ tab: "approvals" }}>
                Review
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {unseenAnnouncementCount > 0 && (
        <Card className="border-amber-500/30 bg-amber-50/50 shadow-card dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <Megaphone className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {unseenAnnouncementCount} new{" "}
                {unseenAnnouncementCount === 1 ? "announcement" : "announcements"}
              </p>
              <p className="text-xs text-muted-foreground">
                Something's been shared with the team.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/announcements">Read</Link>
            </Button>
          </CardContent>
        </Card>
      )}

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

      {!unsubmittedDismissed && unsubmittedPastWeeks.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-50/50 shadow-card dark:bg-amber-950/20">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {unsubmittedPastWeeks.length === 1
                  ? "1 week is still waiting on you"
                  : `${unsubmittedPastWeeks.length} weeks are still waiting on you`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {unsubmittedPastWeeks
                  .map(
                    (w) =>
                      formatWeekRange(w.weekStart) +
                      (w.status === "Rejected" ? " (sent back)" : ""),
                  )
                  .join(" · ")}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/timesheet">Review</Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              aria-label="Dismiss"
              onClick={() => setUnsubmittedDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {showWeekNudge && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Nothing logged this week yet — worth a quick catch-up before it wraps up.</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            aria-label="Dismiss"
            onClick={() => setWeekNudgeDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked today"
          value={formatMinutes(todayMinutes)}
          hint={`Goal ${formatHours(dailyGoal)} · ${todayEntries.length} entries`}
        />
        <StatCard
          label="This week"
          value={formatHours(weekTotal)}
          hint={`Across ${activeProjects} projects`}
        />
        <StatCard label="Daily average" value={formatHours(weekTotal / 5)} hint="Mon – Fri" />
        <StatCard
          label="Billable share"
          value={`${billableShare}%`}
          hint="Of hours logged this week"
        />
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
                      style={{
                        height: `${maxDay ? Math.max((t / maxDay) * 100, t > 0 ? 4 : 0) : 0}%`,
                      }}
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

      {lastWeekEntries.length > 0 && (
        <Card className="mt-6 shadow-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Last week · {formatWeekRange(lastWeekStart)}
              </p>
              <p className="text-sm font-medium">
                {formatHours(lastWeekMinutes / 60)} across {lastWeekProjectCount}{" "}
                {lastWeekProjectCount === 1 ? "project" : "projects"}
              </p>
            </div>
            <Badge variant={lastWeekBadgeVariant}>{lastWeekStatus ?? "Not submitted"}</Badge>
          </CardContent>
        </Card>
      )}
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
