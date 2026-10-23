import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { PictureInPicture2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { formatTimerClock, runningTimerLines, timerStoppedMessage } from "@/lib/timer-display";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

// Document Picture-in-Picture (Chrome and Edge 116+) isn't in TypeScript's
// DOM types yet.
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    };
  }
}

/**
 * What the Time page's timer bar holds while a timer runs: the description
 * being typed (nothing writes it to the entry until the timer stops) and the
 * bar's own stop, which saves that text. The floating window reads both, so
 * it shows the live text and stopping from it can't throw away what was
 * typed. Module-level, like warnedThresholds in running-timer.tsx, because
 * the bar and the window sit in different parts of the tree.
 */
type TimerBarDraft = { description: string; stop: () => Promise<void> };

let timerBarDraft: TimerBarDraft | null = null;
const draftListeners = new Set<() => void>();
const emitDraft = () => draftListeners.forEach((listener) => listener());
const subscribeDraft = (listener: () => void) => {
  draftListeners.add(listener);
  return () => void draftListeners.delete(listener);
};

/** Called by the Time page's timer bar; pass null when no timer is running. */
export function useShareTimerBarDraft(draft: TimerBarDraft | null) {
  useEffect(() => {
    timerBarDraft = draft;
    emitDraft();
    return () => {
      if (timerBarDraft !== draft) return;
      timerBarDraft = null;
      emitDraft();
    };
  }, [draft]);
}

function useTimerBarDraft() {
  return useSyncExternalStore(
    subscribeDraft,
    () => timerBarDraft,
    () => null,
  );
}

/**
 * Chrome's own recipe for styling a picture-in-picture window: copy every
 * same-origin stylesheet's rules across, and link the rest (Google Fonts)
 * by URL, since their rules can't be read from script.
 */
function copyStylesheets(from: Document, to: Document) {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const style = to.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      to.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      to.head.appendChild(link);
    }
  }
}

type FloatingTimerControls = { supported: boolean; open: boolean; toggle: () => void };

const FloatingTimerContext = createContext<FloatingTimerControls>({
  supported: false,
  open: false,
  toggle: () => {},
});

/**
 * Owns the floating mini timer: a small always-on-top window that shows the
 * running timer while someone works in another tab or app. Sits at the root
 * rather than in AppShell, which every page renders afresh, so the window
 * survives moving between pages. Only ever opened by a click — browsers
 * require one — and it stays open between timers, picking up the next one
 * by itself.
 */
export function FloatingTimerProvider({ children }: { children: ReactNode }) {
  const { session } = useWorkspace();
  const [supported, setSupported] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // After mount: the server render can't know, and guessing would make the
  // button flash in or out on hydration.
  useEffect(() => setSupported(!!window.documentPictureInPicture), []);

  const toggle = useCallback(async () => {
    if (pipWindow) {
      pipWindow.close();
      return;
    }
    const api = window.documentPictureInPicture;
    if (!api) return;
    try {
      const pip = await api.requestWindow({ width: 320, height: 136 });
      copyStylesheets(document, pip.document);
      pip.document.title = "IronTrack timer";
      pip.addEventListener("pagehide", () => setPipWindow(null), { once: true });
      setPipWindow(pip);
    } catch (error) {
      toast.error("Couldn't open the mini timer", { description: (error as Error).message });
    }
  }, [pipWindow]);

  // Follows the light/dark toggle in the main window.
  useEffect(() => {
    if (!pipWindow) return;
    const sync = () => {
      pipWindow.document.documentElement.className = document.documentElement.className;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [pipWindow]);

  useEffect(() => {
    if (!session) pipWindow?.close();
  }, [session, pipWindow]);

  const controls = useMemo(
    () => ({ supported, open: !!pipWindow, toggle: () => void toggle() }),
    [supported, pipWindow, toggle],
  );

  return (
    <FloatingTimerContext.Provider value={controls}>
      {children}
      {pipWindow && createPortal(<FloatingTimer host={pipWindow} />, pipWindow.document.body)}
    </FloatingTimerContext.Provider>
  );
}

/** Opens or closes the mini timer. Renders nothing in browsers that can't show one. */
export function PopOutTimerButton({ className }: { className?: string }) {
  const { supported, open, toggle } = useContext(FloatingTimerContext);
  if (!supported) return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn("shrink-0", className)}
      aria-label="Mini timer"
      aria-pressed={open}
      title={
        open ? "Close the mini timer" : "Pop out a mini timer that stays on top of other windows"
      }
      onClick={toggle}
    >
      <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

function FloatingTimer({ host }: { host: Window }) {
  const { runningEntry, projects, stopTimer } = useWorkspace();
  const navigate = useNavigate();
  const draft = useTimerBarDraft();
  // Ticks on the mini window's own timers: it's on screen, so they run every
  // second even while the IronTrack tab is in the background.
  const seconds = useElapsedSeconds(runningEntry?.startTime ?? null, host);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningId = runningEntry?.id;

  useEffect(() => setError(null), [runningId]);

  // `window` here is the main IronTrack window, not the mini one.
  const backToApp = () => window.focus();

  if (!runningEntry) {
    return (
      <div className="flex h-screen items-center justify-between gap-3 px-4">
        <span className="text-sm text-muted-foreground">No timer running</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            backToApp();
            void navigate({ to: "/time" });
          }}
        >
          Open IronTrack
        </Button>
      </div>
    );
  }

  const project = projects.find((p) => p.id === runningEntry.projectId);
  const { label, detail } = runningTimerLines(
    { description: draft?.description ?? runningEntry.description, task: runningEntry.task },
    project,
  );
  const color = project?.color ?? "var(--brand)";

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      if (draft) {
        await draft.stop();
      } else {
        const result = await stopTimer(runningEntry.id);
        toast.success("Timer stopped", {
          description: timerStoppedMessage(result.splitAcrossDays),
        });
      }
    } catch (e) {
      // A toast would land in the main window, out of sight — say it here.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen flex-col justify-center gap-1 px-4 py-3">
      <button
        type="button"
        onClick={backToApp}
        title="Back to IronTrack"
        className="flex min-w-0 items-center gap-2 rounded text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </button>
      {detail && <p className="truncate pl-4.5 text-xs text-muted-foreground">{detail}</p>}
      <div className="mt-1 flex items-center justify-between gap-3">
        <span
          className="font-mono text-2xl font-semibold tabular-nums tracking-tight"
          style={{ color: "var(--brand)" }}
        >
          {formatTimerClock(seconds)}
        </span>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          disabled={busy}
          onClick={() => void stop()}
        >
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          Stop
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Couldn't stop: {error}
        </p>
      )}
    </div>
  );
}
