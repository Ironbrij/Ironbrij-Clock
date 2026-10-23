// Reports → Casual Service's performance section: the accounts workbook's
// WEEKLY DASHBOARD "Casual services performance" (hours per VA per category)
// and its weekly-performance rows (this period against the one before).
import { billableHoursForCasualEntry } from "@/lib/casual-billing";
import { addDays, fromDateKey, toDateKey } from "@/lib/time-utils";
import type { CasualServiceCategory } from "@/lib/workspace/types";

type PerformanceEntry = {
  userId: string;
  seconds: number;
  serviceCategory: CasualServiceCategory | null;
};
type BillingOpts = { incrementHours: number; upliftPct: number };

/** Hours per category plus their total. Paid Casual is after increments, as in the sheet. */
export type CasualHours = Record<CasualServiceCategory, number> & { total: number };

export type VaPerformanceRow = { userId: string; hours: CasualHours };

const emptyHours = (): CasualHours => ({
  paid_casual: 0,
  promotional: 0,
  vip_client: 0,
  ironbrij: 0,
  total: 0,
});

// Per entry, never on a pre-summed total: the increment rounds each line up
// (see casual-billing.ts), so this is also what makes the VA rows add up to
// the overall figure.
function addEntry(hours: CasualHours, e: PerformanceEntry, billing: BillingOpts) {
  if (!e.serviceCategory) return;
  const h = billableHoursForCasualEntry(e, e.serviceCategory, billing);
  hours[e.serviceCategory] += h;
  hours.total += h;
}

export function casualHoursTotals(entries: PerformanceEntry[], billing: BillingOpts) {
  const hours = emptyHours();
  let paidCasualActual = 0;
  for (const e of entries) {
    addEntry(hours, e, billing);
    if (e.serviceCategory === "paid_casual") paidCasualActual += e.seconds / 3600;
  }
  return { hours, paidCasualActual };
}

/** One row per person with casual hours, most Paid Casual first, then most hours overall. */
export function casualPerformanceByVa(
  entries: PerformanceEntry[],
  billing: BillingOpts,
): VaPerformanceRow[] {
  const byUser = new Map<string, CasualHours>();
  for (const e of entries) {
    if (!e.serviceCategory) continue;
    let hours = byUser.get(e.userId);
    if (!hours) {
      hours = emptyHours();
      byUser.set(e.userId, hours);
    }
    addEntry(hours, e, billing);
  }
  return [...byUser.entries()]
    .map(([userId, hours]) => ({ userId, hours }))
    .sort((a, b) => b.hours.paid_casual - a.hours.paid_casual || b.hours.total - a.hours.total);
}

export function topPaidCasualVa(rows: VaPerformanceRow[]): VaPerformanceRow | null {
  return rows.reduce<VaPerformanceRow | null>(
    (best, r) => (r.hours.paid_casual > (best?.hours.paid_casual ?? 0) ? r : best),
    null,
  );
}

/**
 * The period to compare a range against: the same days, moved back in whole
 * weeks so weekdays line up. A full week compares with the week before, as
 * the sheet does; a week so far (Monday to Thursday) compares with Monday to
 * Thursday of last week rather than with a stretch that includes a weekend.
 */
export function previousPeriod(from: string, to: string) {
  const days =
    Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000) + 1;
  const shift = Math.ceil(days / 7) * 7;
  return {
    from: toDateKey(addDays(fromDateKey(from), -shift)),
    to: toDateKey(addDays(fromDateKey(to), -shift)),
  };
}

// Fixed rather than toLocaleDateString: some locales print September as
// "Sept", and this label sits next to the sheet's.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date range as "12 – 18 Oct", naming months and years only where the two ends differ. */
export function formatDateSpan(from: string, to: string) {
  const a = fromDateKey(from);
  const b = fromDateKey(to);
  const day = (d: Date) => String(d.getDate());
  const month = (d: Date) => MONTHS[d.getMonth()];
  if (from === to) return `${day(a)} ${month(a)}`;
  if (a.getFullYear() !== b.getFullYear())
    return `${day(a)} ${month(a)} ${a.getFullYear()} – ${day(b)} ${month(b)} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
  return `${day(a)} – ${day(b)} ${month(b)}`;
}

/** Difference and % change against the earlier figure; no % when that was zero. */
export function periodChange(current: number, previous: number) {
  return {
    difference: current - previous,
    pct: previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10,
  };
}
