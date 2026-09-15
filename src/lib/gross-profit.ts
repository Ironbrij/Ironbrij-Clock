import { billableHoursForCasualEntry } from "@/lib/casual-billing";
import type { CasualServiceCategory } from "@/lib/workspace/types";

/** One effective-dated invoice rate. `userId === null` is the client's default rate. */
export type BillingRate = {
  clientId: string;
  userId: string | null;
  hourlyRate: number;
  /** ISO date key (YYYY-MM-DD) this rate starts applying from. */
  effectiveFrom: string;
};

/**
 * M48: resolves what a client is charged per hour for a given VA on a given
 * date.
 *
 * Two dimensions, in priority order:
 *
 *   1. **Scope** — a per-VA override for this client beats the client's
 *      default. The source workbook bills the same client at different
 *      rates depending on who did the work, so the override is the norm
 *      rather than an exception.
 *   2. **Date** — within the winning scope, the latest rate whose
 *      `effectiveFrom` is on or before `onDate`. Rates entered today
 *      therefore never rewrite what last month's report already showed.
 *
 * Returns null when no rate applies — an unpriced pairing, or work that
 * predates the first rate anyone entered. Callers render that as "no rate
 * set" rather than $0.00, since the two mean very different things to an
 * accounts team.
 *
 * Date strings are compared lexicographically, which is exact for the
 * zero-padded YYYY-MM-DD keys used throughout this app (see
 * `toDateKey` in time-utils.ts).
 */
export function resolveInvoiceRate(
  rates: BillingRate[],
  clientId: string,
  userId: string,
  onDate: string,
): number | null {
  let best: BillingRate | null = null;
  for (const rate of rates) {
    if (rate.clientId !== clientId) continue;
    if (rate.userId !== null && rate.userId !== userId) continue;
    if (rate.effectiveFrom > onDate) continue;
    if (best === null) {
      best = rate;
      continue;
    }
    // A VA override outranks a client default regardless of either date.
    const bestIsOverride = best.userId !== null;
    const rateIsOverride = rate.userId !== null;
    if (rateIsOverride !== bestIsOverride) {
      if (rateIsOverride) best = rate;
      continue;
    }
    if (rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best?.hourlyRate ?? null;
}

export type EntryProfit = {
  /** Billable hours for this line, after the casual increment rounding. */
  hours: number;
  cost: number | null;
  revenue: number | null;
  /** Never null — unpriced work is $0 profit (cost-only), not unknown profit. */
  profit: number;
};

/**
 * M48: the per-entry money math behind the Gross Profit report.
 *
 * Deliberately per-entry, never on a pre-summed total: the casual
 * increment rounds each task line up on its own, so rounding a sum gives a
 * different — and wrong — number than summing rounded lines. That is the
 * same reasoning 20260903010000_casual_service_reports.sql gives for not
 * writing this as a SQL aggregate.
 *
 * `hours` is the increment-rounded figure, and **both** sides of the
 * equation use it. That was the confirmed call: the source workbook pays
 * the VA on the same rounded hours it invoices the client for (Vellih's
 * 6.25h on Kim Wasley is $50.50 paid at $8.08 and $93.75 invoiced at
 * $15.00), so cost computed any other way would stop reconciling against
 * the payroll figures accounts already works from.
 *
 * Revenue requires all three of: a billable entry, a category that is
 * actually chargeable, and a resolved rate. Internal work therefore lands
 * as cost-only with zero profit rather than being dropped — its wages
 * still have to show up somewhere for the totals to mean anything.
 */
export function grossProfitForEntry(
  entry: { minutes: number; billable: boolean; serviceCategory: CasualServiceCategory | null },
  opts: { payRate: number | null; invoiceRate: number | null; incrementHours: number },
): EntryProfit {
  const hours = billableHoursForCasualEntry(entry, entry.serviceCategory, opts.incrementHours);
  const cost = opts.payRate === null ? null : hours * opts.payRate;

  // 'ironbrij' is casual work that is tracked but never charged — the same
  // exclusion billableHoursForCasualEntry already applies to its rounding.
  const chargeable = entry.billable && entry.serviceCategory !== "ironbrij";
  const revenue = chargeable && opts.invoiceRate !== null ? hours * opts.invoiceRate : null;

  return {
    hours,
    cost,
    revenue,
    profit: revenue === null ? 0 : revenue - (cost ?? 0),
  };
}
