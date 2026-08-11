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
