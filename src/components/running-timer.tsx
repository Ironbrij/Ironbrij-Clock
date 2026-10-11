import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-store";

const pad = (n: number) => n.toString().padStart(2, "0");

export function formatClock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(seconds % 60)}`;
}

/** Wall-clock seconds since `startTime`, ticking once a second; 0 when there's no timer. */
export function useElapsedSeconds(startTime: string | null) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!startTime) {
      setSeconds(0);
      return;
    }
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  return seconds;
}

// Keyed by entry id and kept at module level, so the Time page's timer bar
// and the header pill never both warn about the same threshold of the same
// timer — including when someone moves between pages while it runs.
const warnedThresholds = new Set<string>();

/**
 * Warns once per threshold if a timer's been running an unusually long time
 * — almost always means someone forgot to stop it, not that they've genuinely
 * been on one task for 8+ hours straight. Based on wall-clock elapsed time,
 * so it catches up immediately if the tab was closed or backgrounded past a
 * threshold.
 */
export function useLongRunningTimerWarnings(
  entryId: string | null,
  seconds: number,
  onStop: () => void,
  enabled = true,
) {
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  useEffect(() => {
    if (!enabled || !entryId) return;
    for (const hours of [4, 8, 12]) {
      const key = `${entryId}:${hours}`;
      if (seconds >= hours * 3600 && !warnedThresholds.has(key)) {
        warnedThresholds.add(key);
        toast.warning(`Still running after ${hours} hour${hours > 1 ? "s" : ""}`, {
          description: "If you forgot to stop this timer, you can stop it now.",
          duration: 15000,
          action: { label: "Stop timer", onClick: () => onStopRef.current() },
        });
      }
    }
  }, [enabled, entryId, seconds]);
}

const TITLE_PREFIX = /^▶ \d+:\d{2}:\d{2} · /;

/** Puts the running time at the front of the browser tab's title, so it shows from any tab. */
function useTimerTabTitle(seconds: number | null) {
  useEffect(() => {
    const base = document.title.replace(TITLE_PREFIX, "");
    document.title = seconds === null ? base : `▶ ${formatClock(seconds)} · ${base}`;
  }, [seconds]);
  useEffect(
    () => () => {
      document.title = document.title.replace(TITLE_PREFIX, "");
    },
    [],
  );
}

/**
 * The running timer, visible from every page: a compact pill in the header
 * with the project, the elapsed time and a Stop button, plus the elapsed time
 * in the browser tab title. Hidden on /time, where the full timer bar already
 * shows all of this (and owns the description being typed, which a stop from
 * here would otherwise discard).
 */
export function RunningTimerPill() {
  const { runningEntry, projects, stopTimer } = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const seconds = useElapsedSeconds(runningEntry?.startTime ?? null);
  const [busy, setBusy] = useState(false);
  const onTimePage = pathname === "/time";

  const stop = async () => {
    if (!runningEntry) return;
    setBusy(true);
    try {
      const result = await stopTimer(runningEntry.id);
      toast.success("Timer stopped", {
        description: result.splitAcrossDays
          ? "This ran past midnight, so it's been split into a separate entry for each day."
          : "Entry saved to your timesheet.",
      });
    } catch (error) {
      toast.error("Couldn't stop the timer", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  useTimerTabTitle(runningEntry ? seconds : null);
  useLongRunningTimerWarnings(runningEntry?.id ?? null, seconds, () => void stop(), !onTimePage);

  if (!runningEntry || onTimePage) return null;

  const project = projects.find((p) => p.id === runningEntry.projectId);
  const label = project?.name ?? (runningEntry.description || "No project");
  const color = project?.color ?? "var(--brand)";

  return (
    <div className="flex min-w-0 items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 shadow-card">
      <Link
        to="/time"
        className="flex min-w-0 items-center gap-2 rounded-full text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        title={`Timer running on ${label} — open Time`}
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
            style={{ backgroundColor: color }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        </span>
        <span className="sr-only">Timer running on {label}, </span>
        <span className="hidden max-w-[10rem] truncate sm:inline" aria-hidden="true">
          {label}
        </span>
        <span className="font-mono font-medium tabular-nums">{formatClock(seconds)}</span>
      </Link>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0 rounded-full text-destructive hover:text-destructive"
        aria-label="Stop timer"
        title="Stop timer"
        disabled={busy}
        onClick={() => void stop()}
      >
        <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      </Button>
    </div>
  );
}
