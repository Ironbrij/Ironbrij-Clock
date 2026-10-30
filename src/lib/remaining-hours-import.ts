/**
 * Reading a paste of client names and remaining hours, copied from the
 * accounts team's Casual Service | Monitoring sheet, for Projects → Clients →
 * Import remaining hours. Pure functions only: the dialog decides what to
 * show and what to save.
 */

/** A pasted line that had a name and a number. `line` counts from 1, as the person sees the paste. */
export type ParsedLine = { line: number; name: string; hours: number };
/** A pasted line with no number at the end: a header, a total row, a typo. Shown back, never applied. */
export type UnreadLine = { line: number; text: string };

const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;

/**
 * One cell as hours: thousands commas dropped, and a negative written as
 * `-23.62`, `−23.62` (the minus sign Sheets and PDFs use) or `(23.62)`.
 * Null when the cell isn't a number.
 */
export function parseHoursCell(cell: string): number | null {
  let text = cell.trim();
  let negative = false;
  const bracketed = /^\((.*)\)$/.exec(text);
  if (bracketed) {
    negative = true;
    text = bracketed[1].trim();
  }
  text = text.replace(/\u2212/g, "-").replace(/,/g, "");
  if (!NUMBER.test(text)) return null;
  const hours = Number(text);
  return negative ? -hours || 0 : hours;
}

/** Splits one pasted line into cells: on tabs (what Google Sheets copies), else at the last space. */
function cellsOf(text: string): string[] {
  if (text.includes("\t")) {
    return text
      .split("\t")
      .map((c) => c.trim())
      .filter((c) => c !== "");
  }
  const lastSpace = text.lastIndexOf(" ");
  return lastSpace < 0 ? [text] : [text.slice(0, lastSpace).trim(), text.slice(lastSpace + 1)];
}

/**
 * Each non-blank line becomes a row (name = first cell, hours = last cell)
 * or, when its last cell isn't a number, an unread line. Blank lines are
 * skipped but still counted, so line numbers match the paste.
 */
export function parseRemainingHoursPaste(text: string): {
  rows: ParsedLine[];
  unread: UnreadLine[];
} {
  const rows: ParsedLine[] = [];
  const unread: UnreadLine[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const cells = cellsOf(trimmed);
    const hours = cells.length >= 2 ? parseHoursCell(cells[cells.length - 1]) : null;
    if (hours === null || cells[0] === "") {
      unread.push({ line, text: trimmed });
      return;
    }
    rows.push({ line, name: cells[0], hours });
  });
  return { rows, unread };
}

/** Case, spacing and accents don't count when comparing a sheet name with a client's name. */
export function normaliseClientName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The client each pasted line names, by line number: an exact match after
 * normalising, or null. Never a near match: a wrong guess would set some
 * other client's hours.
 */
export function matchClientNames(
  rows: ParsedLine[],
  clients: { id: string; name: string }[],
): Map<number, string | null> {
  const byName = new Map<string, string>();
  for (const c of clients) {
    const key = normaliseClientName(c.name);
    if (!byName.has(key)) byName.set(key, c.id);
  }
  return new Map(rows.map((r) => [r.line, byName.get(normaliseClientName(r.name)) ?? null]));
}

/**
 * The subscription hours that make IronTrack's remaining hours equal the
 * sheet's: remaining = subscription − rendered, so subscription = sheet's
 * remaining + rendered (tracked time plus placement weeks). Rounded to the
 * cent, as clients.subscription_hours stores it.
 */
export function newSubscriptionHours(sheetRemaining: number, renderedHours: number): number {
  return Math.round((sheetRemaining + renderedHours) * 100) / 100;
}

/**
 * - `ok`: can be applied.
 * - `no-change`: IronTrack already shows the sheet's figure.
 * - `unmatched`: no client chosen for the sheet's name yet.
 * - `duplicate`: another line points at the same client, so which figure is
 *   right is unclear. Neither can be applied until one is changed.
 */
export type PreviewStatus = "ok" | "no-change" | "unmatched" | "duplicate";

export type PreviewRow = {
  line: number;
  sheetName: string;
  sheetHours: number;
  clientId: string | null;
  /** IronTrack's remaining hours now; null when the client has no allowance (or no client is chosen). */
  currentRemaining: number | null;
  /** Sheet minus IronTrack, to the cent; null when there's nothing to compare with. */
  difference: number | null;
  /** What subscription_hours would become; null with no client. */
  newSubscription: number | null;
  status: PreviewStatus;
};

/**
 * One preview row per pasted line. `chosen` is the client for each line:
 * matchClientNames' answer, or what the person picked for a name it couldn't
 * match. `figures` holds every client's subscription and rendered hours.
 */
export function buildPreviewRows(
  rows: ParsedLine[],
  chosen: Map<number, string | null>,
  figures: Map<string, { subscriptionHours: number | null; renderedHours: number }>,
): PreviewRow[] {
  const linesPerClient = new Map<string, number>();
  for (const r of rows) {
    const id = chosen.get(r.line);
    if (id) linesPerClient.set(id, (linesPerClient.get(id) ?? 0) + 1);
  }
  return rows.map((r) => {
    const clientId = chosen.get(r.line) ?? null;
    const f = clientId ? figures.get(clientId) : undefined;
    const currentRemaining =
      f && f.subscriptionHours !== null ? f.subscriptionHours - f.renderedHours : null;
    const difference =
      currentRemaining === null ? null : Math.round((r.hours - currentRemaining) * 100) / 100 || 0;
    const status: PreviewStatus = !clientId
      ? "unmatched"
      : (linesPerClient.get(clientId) ?? 0) > 1
        ? "duplicate"
        : difference === 0
          ? "no-change"
          : "ok";
    return {
      line: r.line,
      sheetName: r.name,
      sheetHours: r.hours,
      clientId,
      currentRemaining,
      difference,
      newSubscription: clientId ? newSubscriptionHours(r.hours, f?.renderedHours ?? 0) : null,
      status,
    };
  });
}
