// What the running timer looks like outside the Time page's own timer bar:
// the header pill, the browser tab title and the floating mini timer.

const pad = (n: number) => n.toString().padStart(2, "0");

/** Elapsed seconds as HH:MM:SS. Hours keep counting past 99. */
export function formatTimerClock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(seconds % 60)}`;
}

const TITLE_PREFIX = /^▶ \d+:\d{2}(?::\d{2})? · /;

export function stripTimerTitle(title: string) {
  return title.replace(TITLE_PREFIX, "");
}

/**
 * The tab title with the running time in front, so it shows from any tab.
 * A background tab only gets its timers run about once a minute (Chrome's
 * intensive throttling), so there the clock drops to H:MM rather than show
 * seconds that sit frozen and look stopped.
 */
export function timerTabTitle(title: string, seconds: number | null, hidden: boolean) {
  const base = stripTimerTitle(title);
  if (seconds === null) return base;
  const clock = hidden
    ? `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}`
    : formatTimerClock(seconds);
  return `▶ ${clock} · ${base}`;
}

/**
 * The running timer's headline and the line under it. Leads with the
 * project; without one, the description takes its place.
 */
export function runningTimerLines(
  entry: { description: string; task: string },
  project: { name: string } | undefined,
): { label: string; detail: string | null } {
  const description = entry.description.trim();
  if (project) return { label: project.name, detail: description || entry.task || null };
  return { label: description || "No project", detail: entry.task || null };
}

export function timerStoppedMessage(splitAcrossDays: boolean) {
  return splitAcrossDays
    ? "This ran past midnight, so it's been split into a separate entry for each day."
    : "Entry saved to your timesheet.";
}
