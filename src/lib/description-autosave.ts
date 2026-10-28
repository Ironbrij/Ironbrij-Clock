/**
 * Saves a running timer's description to its entry while it's being typed,
 * the way Clockify does. Until this, the text lived only in the Time page's
 * timer bar and reached the entry when the timer stopped, so leaving the
 * page or any refetch of the entries (coming back to the tab, a change from
 * another tab or device) put the entry's old text back in the box.
 *
 * Plain TypeScript rather than a hook so the timing can be tested. The timer
 * bar feeds it what's typed and what the entry holds, and it decides when to
 * save and whether a change to the entry should replace what's in the box.
 */

const DEFAULT_DELAY_MS = 1000;

export type DescriptionAutosave = {
  /** A timer started, or the bar opened on one already running; `null` when none is. Its saved text is the starting point. */
  reset: (entryId: string | null, savedText: string) => void;
  /** The person typed. Saved once they pause for `delayMs`. */
  edit: (text: string) => void;
  /** Save now instead of waiting: the box lost focus, or the page is going away. */
  flush: () => void;
  /** Drops a save that hasn't gone out and waits for any that has. Stop calls this first, since it saves the text itself. */
  settle: () => Promise<void>;
  /**
   * The entry's saved text changed. Returns what the box should show instead,
   * or null to leave the box alone — always the case while there's typing the
   * entry doesn't have yet, so a refetch can never wipe it.
   */
  entryChanged: (savedText: string) => string | null;
};

export function createDescriptionAutosave({
  save,
  canSave = () => true,
  onError = () => {},
  delayMs = DEFAULT_DELAY_MS,
}: {
  save: (entryId: string, text: string) => Promise<void>;
  /** Text to leave unsaved, such as a blank box when descriptions are required. */
  canSave?: (text: string) => boolean;
  onError?: (error: Error) => void;
  delayMs?: number;
}): DescriptionAutosave {
  let entryId: string | null = null;
  // What the entry holds as far as we know, and what's in the box.
  let saved = "";
  let draft = "";
  // The newest text sent or waiting to be sent, so the same text isn't queued twice.
  let queued: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  // One save at a time, so an older text can never land after a newer one.
  let chain: Promise<void> = Promise.resolve();
  // Bumped by reset, so a save for the previous timer doesn't count as saved for the next.
  let generation = 0;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clearTimer();
    const id = entryId;
    const text = draft;
    if (id === null || text === (queued ?? saved) || !canSave(text)) return;
    const gen = generation;
    queued = text;
    inFlight += 1;
    chain = chain
      .then(() => save(id, text))
      .then(
        () => {
          if (gen === generation) saved = text;
        },
        (error: unknown) => onError(error instanceof Error ? error : new Error(String(error))),
      )
      .finally(() => {
        inFlight -= 1;
        if (inFlight === 0) queued = null;
      });
  };

  return {
    reset(id, savedText) {
      clearTimer();
      generation += 1;
      entryId = id;
      saved = savedText;
      draft = savedText;
      queued = null;
    },
    edit(text) {
      draft = text;
      clearTimer();
      if (entryId !== null) timer = setTimeout(flush, delayMs);
    },
    flush,
    settle() {
      clearTimer();
      return chain;
    },
    entryChanged(savedText) {
      if (timer !== null || inFlight > 0 || draft !== saved || savedText === saved) return null;
      saved = savedText;
      draft = savedText;
      return savedText;
    },
  };
}
