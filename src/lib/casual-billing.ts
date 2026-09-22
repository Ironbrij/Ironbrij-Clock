import type { CasualServiceCategory } from "@/lib/workspace/types";

/**
 * Guard against binary floating point pushing an exact increment boundary
 * onto the next step up.
 *
 * This only became a real hazard in M51. Before the uplift existed, the
 * inputs to the division were a clean tracked duration and a clean
 * increment, and an exact multiple divided exactly. Multiplying by 1.2
 * first breaks that: 100 minutes is 1.6666666666666667h, which times 1.2
 * is 2.0000000000000004 rather than 2 — and 2.0000000000000004 / 0.25 is
 * 8.000000000000002, which Math.ceil dutifully rounds to 9, billing 2.25h
 * for work that came to exactly 2. A tolerance this small can't absorb a
 * genuine overrun (the smallest real one, a single second, is 0.00028h) but
 * comfortably absorbs the representation error.
 */
const INCREMENT_EPSILON = 1e-9;

/**
 * M46: the accounts team's manual workbook's "Hours After Adding Increment"
 * column, reimplemented as a pure function computed at report time — never
 * mutates an entry's own tracked duration. Raw tracked time stays the
 * source of truth; billing rounding is a presentation-layer concern.
 *
 * This is a narrower, deliberately re-confirmed exception to the general
 * time-rounding feature docs/audit-findings.md's "Unnecessary" section
 * already rejected for the core app — not a reversal of that call. It's
 * scoped only to the three paid casual-service categories.
 *
 * Per the workbook's own header comment ("Ironbrij is excluded from the
 * additional increment"), 'ironbrij'-category work passes through at its
 * exact tracked hours, since it's never actually billed. A non-casual
 * entry (`category === null`) is likewise untouched — this function only
 * ever changes the number for paid casual/VIP/promotional work.
 *
 * M51: the client uplift (`upliftPct`, 20 by default) now applies **before**
 * the round-up, which is the order the product owner confirmed: 6.10h
 * becomes 7.32h, which rounds to 7.50h. Rounding first would give the same
 * answer here but diverges as soon as the decimals fall differently, so the
 * order is load-bearing rather than incidental.
 *
 * The scope is deliberately unchanged from M46 — paid casual, VIP client and
 * promotional only, confirmed explicitly when M51 was specified. Regular
 * client work and retainer work still pass through raw, so this function
 * never silently inflates anything outside the casual programme.
 */
export function billableHoursForCasualEntry(
  entry: { seconds: number },
  category: CasualServiceCategory | null,
  { incrementHours, upliftPct }: { incrementHours: number; upliftPct: number },
): number {
  const rawHours = entry.seconds / 3600;
  if (category === null || category === "ironbrij") return rawHours;

  const uplifted = upliftPct > 0 ? rawHours * (1 + upliftPct / 100) : rawHours;
  if (incrementHours <= 0) return uplifted;

  // Math.max keeps a zero-length entry at +0. Without it the epsilon pushes
  // 0 / increment to -1e-9, which ceils to -0 and multiplies through to -0 —
  // harmless arithmetically, but it renders as "-0.00" in a report column.
  const steps = Math.max(0, Math.ceil(uplifted / incrementHours - INCREMENT_EPSILON));
  return steps * incrementHours;
}
