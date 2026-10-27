import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { PopOutTimerButton } from "@/components/floating-timer";
import { Button } from "@/components/ui/button";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import {
  formatTimerClock,
  runningTimerLines,
  stripTimerTitle,
  timerStoppedMessage,
  timerTabTitle,
} from "@/lib/timer-display";
import { useWorkspace } from "@/lib/workspace-store";

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

function useDocumentHidden() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.hidden,
    () => false,
  );
}

/** Puts the running time at the front of the browser tab's title, so it shows from any tab. */
function useTimerTabTitle(seconds: number | null) {
  const hidden = useDocumentHidden();
  useEffect(() => {
    document.title = timerTabTitle(document.title, seconds, hidden);
  }, [seconds, hidden]);
  useEffect(
    () => () => {
      document.title = stripTimerTitle(document.title);
    },
    [],
  );
}

// Drawn once, then reused by every page's pill.
let runningIcon: Promise<string> | null = null;

/** The site icon with a red "recording" dot in the corner, as a data URL. */
function drawRunningIcon(baseHref: string) {
  runningIcon ??= new Promise((resolve) => {
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(baseHref);
    const finish = () => {
      // A canvas can't read CSS variables, hence a literal red; the white
      // ring keeps the dot visible against a dark tab strip.
      ctx.beginPath();
      ctx.arc(size - 8, size - 8, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#e5484d";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      resolve(canvas.toDataURL("image/png"));
    };
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, size, size);
      finish();
    };
    // No base icon to draw on: the dot alone still says "running".
    image.onerror = finish;
    image.src = baseHref;
  });
  return runningIcon;
}

/** Swaps the tab's icon for one with a red dot while a timer runs. */
function useTimerFavicon(running: boolean) {
  useEffect(() => {
    if (!running) return;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    if (links.length === 0) return;
    const originals = links.map((link) => ({
      href: link.getAttribute("href"),
      type: link.getAttribute("type"),
    }));
    let cancelled = false;
    void drawRunningIcon(links[0].href).then((href) => {
      if (cancelled) return;
      for (const link of links) {
        link.type = "image/png";
        link.href = href;
      }
    });
    return () => {
      cancelled = true;
      links.forEach((link, i) => {
        const { href, type } = originals[i];
        if (href) link.setAttribute("href", href);
        if (type) link.setAttribute("type", type);
      });
    };
  }, [running]);
}

/**
 * The running timer, visible from every page: a compact pill in the header
 * with the project, the elapsed time, a Stop button and the mini timer's
 * pop-out button, plus the elapsed time in the browser tab title and a red
 * dot on its icon. Hidden on /time, where the full timer bar already shows
 * all of this (and owns the description being typed, which a stop from here
 * would otherwise discard).
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
        description: timerStoppedMessage(result.splitAcrossDays),
      });
    } catch (error) {
      toast.error("Couldn't stop the timer", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  useTimerTabTitle(runningEntry ? seconds : null);
  useTimerFavicon(!!runningEntry);
  useLongRunningTimerWarnings(runningEntry?.id ?? null, seconds, () => void stop(), !onTimePage);

  if (!runningEntry || onTimePage) return null;

  const project = projects.find((p) => p.id === runningEntry.projectId);
  const { label } = runningTimerLines(runningEntry, project);
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
        <span className="font-mono font-medium tabular-nums">{formatTimerClock(seconds)}</span>
      </Link>
      <PopOutTimerButton className="h-7 w-7 rounded-full" />
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
