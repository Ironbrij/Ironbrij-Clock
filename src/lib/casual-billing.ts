import type { CasualServiceCategory } from "@/lib/workspace/types";

/**
 * M46: the accounts team's manual workbook's "Hours After Adding Increment"
 * column, reimplemented as a pure function computed at report time — never
 * mutates an entry's own tracked `minutes`. Raw tracked time stays the
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
 */
export function billableHoursForCasualEntry(
  entry: { minutes: number },
  category: CasualServiceCategory | null,
  incrementHours: number,
): number {
  const rawHours = entry.minutes / 60;
  if (category === null || category === "ironbrij" || incrementHours <= 0) return rawHours;
  return Math.ceil(rawHours / incrementHours) * incrementHours;
}
