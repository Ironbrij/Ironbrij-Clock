/**
 * Throws if the Supabase response carried an error — the one-line check
 * repeated after nearly every mutation across every workspace/*.ts domain
 * file. Pass `friendlyByCode` to swap a raw Postgres error (matched by its
 * error `code`, e.g. "23505" for a unique-violation) for a human-readable
 * message — used where a DB constraint is the backstop for a rule the UI
 * also tries to prevent client-side (e.g. one running timer per user,
 * no overlapping entries).
 */
export function throwIf(
  error: { message: string; code?: string } | null,
  friendlyByCode?: Record<string, string>,
): void {
  if (!error) return;
  const friendly = error.code ? friendlyByCode?.[error.code] : undefined;
  throw new Error(friendly ?? error.message);
}

/**
 * Fetches every row of a query, up to `maxRows`, in as many requests as it
 * takes. PostgREST caps each response at the project's "Max rows" API
 * setting (1,000 on this project) and `.limit()` can't raise that — a
 * `.limit(5000)` just comes back with 1,000 rows and no error, which is how
 * Reports' Gross Profit used to under-report wide ranges while its own
 * "too many rows" guard never fired.
 *
 * Each request asks for everything still wanted and the server returns up to
 * its own cap, so this never has to know what that cap is; it stops at an
 * empty page or at `maxRows`. A result of exactly `maxRows` rows therefore
 * means "possibly truncated", the same contract callers already check.
 *
 * `buildPage` must order by something unique (finish with `.order("id")`),
 * or rows can repeat or go missing between pages.
 */
/**
 * Upper bound for paged reads that have no row cap of their own (timesheets,
 * the approval queue's entries) — well past real usage, there only so a bug
 * can't page forever.
 */
export const PAGED_READ_MAX_ROWS = 20000;

export async function fetchAllRows<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  maxRows: number,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const { data, error } = await buildPage(rows.length, maxRows - 1);
    throwIf(error);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  return rows;
}
