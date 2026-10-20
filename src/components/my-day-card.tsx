import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProjectDot } from "@/components/app-shell";
import { CopyEodButton } from "@/components/copy-eod-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildDayTimeline } from "@/lib/day-timeline";
import { formatDuration, formatMinutes } from "@/lib/mock-data";
import { ENTRIES_HISTORY_DAYS, addDays, formatDayLong, toDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });

const gapLabel = (minutes: number) => (minutes < 60 ? `${minutes}m` : formatMinutes(minutes));

/**
 * The Dashboard's "My day": one day's entries in the order they happened,
 * as a strip across the day plus a list, with untracked gaps called out —
 * the "where did my day go" check before sending an EOD. Steps back a day
 * at a time, stopping at the oldest day the app actually loads.
 */
export function MyDayCard() {
  const { entries, projectById } = useWorkspace();
  const today = useMemo(() => new Date(), []);
  const [offset, setOffset] = useState(0);
  const day = addDays(today, offset);
  const dayKey = toDateKey(day);
  const atOldest = dayKey <= toDateKey(addDays(today, -ENTRIES_HISTORY_DAYS));

  const dayEntries = useMemo(() => entries.filter((e) => e.date === dayKey), [entries, dayKey]);
  const hasRunning = dayEntries.some((e) => e.running);

  // A running timer's block grows with the clock; tick once a minute while
  // one is on screen rather than re-rendering the dashboard every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  const { items, spanStart, spanEnd } = useMemo(
    () => buildDayTimeline(dayEntries, { now }),
    [dayEntries, now],
  );
  const span = spanStart !== null && spanEnd !== null ? Math.max(spanEnd - spanStart, 1) : 1;
  const trackedSeconds = dayEntries.reduce((s, e) => s + e.seconds, 0);

  return (
    <Card className="mt-6 shadow-card">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">My day</CardTitle>
          <p className="text-xs text-muted-foreground">
            {offset === 0 ? `Today · ${formatDayLong(day)}` : formatDayLong(day)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <CopyEodButton day={day} entries={dayEntries} />
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous day"
            disabled={atOldest}
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next day"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          {offset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
              Today
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 || spanStart === null || spanEnd === null ? (
          <p className="text-sm text-muted-foreground">
            {offset === 0
              ? "Nothing logged yet today — start the timer on the Time page and your day fills in here."
              : "Nothing logged on this day."}
          </p>
        ) : (
          <>
            <div
              className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Tracked between ${clock(spanStart)} and ${clock(spanEnd)}`}
            >
              {items.map((item) =>
                item.kind === "entry" ? (
                  <div
                    key={item.entry.id}
                    className="absolute inset-y-0"
                    style={{
                      left: `${((item.start - spanStart) / span) * 100}%`,
                      width: `max(${((item.end - item.start) / span) * 100}%, 3px)`,
                      backgroundColor:
                        projectById(item.entry.projectId)?.color ?? "var(--muted-foreground)",
                      // A 2px card-coloured edge so back-to-back blocks stay distinguishable.
                      boxShadow: "inset -2px 0 0 var(--card)",
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
              <span>{clock(spanStart)}</span>
              <span>
                {formatDuration(trackedSeconds, { seconds: "never" })} tracked
                {hasRunning ? " + running" : ""}
              </span>
              <span>{hasRunning ? "now" : clock(spanEnd)}</span>
            </div>

            <ol className="mt-4 grid gap-0.5">
              {items.map((item) => {
                if (item.kind === "gap") {
                  return (
                    <li
                      key={`gap-${item.start}`}
                      className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 px-2 py-1 text-xs text-muted-foreground"
                    >
                      <span className="tabular-nums">
                        {clock(item.start)}–{clock(item.end)}
                      </span>
                      <span className="border-t border-dashed border-border" aria-hidden="true" />
                      <span>{gapLabel(item.minutes)} not tracked</span>
                    </li>
                  );
                }
                const { entry } = item;
                const project = projectById(entry.projectId);
                return (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
                  >
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {clock(item.start)}–{entry.running ? "now" : clock(item.end)}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ProjectDot color={project?.color ?? "var(--muted-foreground)"} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {entry.description || "No description"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {project?.name ?? "No project"}
                          {entry.task ? ` · ${entry.task}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">
                      {entry.running ? "running" : formatDuration(entry.seconds)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}
