import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Send } from "lucide-react";
import { toast } from "sonner";
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
import { AppShell, ProjectDot } from "@/components/app-shell";
import { TimesheetGrid } from "@/components/timesheet-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import {
  addDays,
  formatClock,
  formatWeekRange,
  oldestLoadedWeekStart,
  toDateKey,
} from "@/lib/time-utils";
import { useThisWeekStart, useWorkspace, type TimesheetStatus } from "@/lib/workspace-store";

export const Route = createFileRoute("/timesheet")({
  head: () => ({
    meta: [
      { title: "Timesheet — IronTrack" },
      {
        name: "description",
        content:
          "Review your week in a project-by-day grid or a chronological list of logged time entries.",
      },
      { property: "og:title", content: "Timesheet — IronTrack" },
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
  const { entries, projectById, timesheetForWeek } = useWorkspace();

  const dayKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toDateKey(addDays(weekStart, i))),
    [weekStart],
  );
  const weekEntries = entries
    .filter((e) => dayKeys.includes(e.date))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const weekTotal = weekEntries.reduce((s, e) => s + e.minutes, 0) / 60;
  const timesheet = timesheetForWeek(weekStart);
  // See GridView in time.tsx — entries older than this were never fetched,
  // so nav stops here instead of rendering a week that looks empty but
  // just isn't loaded.
  const atOldestLoaded = weekStart <= oldestLoadedWeekStart();

  return (
    <AppShell title="Timesheet" subtitle="Everything you logged this week, in one place.">
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={atOldestLoaded}
            onClick={() => setOffset((w) => w - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="truncate text-sm font-medium">{formatWeekRange(weekStart)}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setOffset((w) => Math.min(0, w + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">
            Total {formatHours(weekTotal)}
          </span>
          {atOldestLoaded && (
            <span className="text-xs text-muted-foreground">
              That's as far back as this view loads — check Reports for anything older.
            </span>
          )}
        </div>
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <SubmissionPanel
        weekStart={weekStart}
        status={timesheet?.status}
        reviewNote={timesheet?.reviewNote ?? null}
        hasEntries={weekEntries.length > 0}
        hasRunningEntry={weekEntries.some((e) => e.running)}
      />

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
                          <p className="truncate text-sm font-medium">
                            {e.description || "No description"}
                          </p>
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

function SubmissionPanel({
  weekStart,
  status,
  reviewNote,
  hasEntries,
  hasRunningEntry,
}: {
  weekStart: Date;
  status?: TimesheetStatus;
  reviewNote: string | null;
  hasEntries: boolean;
  hasRunningEntry: boolean;
}) {
  const { submitTimesheet } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [confirmEarly, setConfirmEarly] = useState(false);

  // H14: submitting a week that hasn't finished yet used to be a silent
  // trap — the moment it's submitted, week_is_locked() covers today too,
  // so the very next timer start or manual entry that same week fails with
  // no warning this was coming. This doesn't block it (someone going on
  // leave for the rest of the week is a legitimate reason to submit
  // early), it just makes sure they know what they're choosing.
  const weekInProgress = Date.now() < addDays(weekStart, 7).getTime();

  const submit = async () => {
    setBusy(true);
    try {
      await submitTimesheet(weekStart);
      toast.success("Timesheet submitted", {
        description: "Your manager will review it from here.",
      });
    } catch (error) {
      toast.error("Couldn't submit that", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitClick = () => {
    if (weekInProgress) {
      setConfirmEarly(true);
      return;
    }
    void submit();
  };

  if (status === "Approved") {
    return (
      <Card className="mb-4 border-primary/20 bg-primary/5 shadow-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Approved — this week is locked</p>
          </div>
          <Badge>Approved</Badge>
        </CardContent>
      </Card>
    );
  }

  if (status === "Submitted") {
    return (
      <Card className="mb-4 shadow-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">
              Locked while it's waiting on your manager to review it.
            </p>
          </div>
          <Badge variant="secondary">Submitted</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 shadow-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          {status === "Rejected" ? (
            <>
              <p className="text-sm font-medium">Sent back — take another look and resubmit.</p>
              {reviewNote && <p className="mt-0.5 text-sm text-muted-foreground">"{reviewNote}"</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {hasRunningEntry
                ? "Stop your timer before submitting this week."
                : "Ready to submit once this week looks right."}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === "Rejected" && <Badge variant="destructive">Changes requested</Badge>}
          <Button
            size="sm"
            className="gap-2"
            disabled={busy || !hasEntries || hasRunningEntry}
            onClick={handleSubmitClick}
            title={
              hasRunningEntry
                ? "Stop your timer before submitting this week"
                : hasEntries
                  ? undefined
                  : "Log some time first"
            }
          >
            <Send className="h-4 w-4" />
            {status === "Rejected" ? "Resubmit" : "Submit for approval"}
          </Button>
        </div>
      </CardContent>
      <AlertDialog open={confirmEarly} onOpenChange={setConfirmEarly}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This week isn't over yet</AlertDialogTitle>
            <AlertDialogDescription>
              Submitting now locks this week for editing right away — including today and any days
              still to come. You won't be able to start a timer or log time for the rest of the week
              until your manager reviews it (or sends it back). Submit anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEarly(false);
                void submit();
              }}
            >
              Submit anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
