/** Throws if the Supabase response carried an error — the one-line check repeated after nearly every mutation across every workspace/*.ts domain file. */
export function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}
