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
  /**
   * M51: hours actually tracked, to the second. What the VA is paid for, and
   * what the internal view of any report shows.
   */
  actualHours: number;
  /**
   * M51: hours actually invoiced — `actualHours` plus the client uplift,
   * rounded up to the billing increment. Equal to `actualHours` for anything
   * outside the three casual categories.
   */
  billedHours: number;
  cost: number | null;
  revenue: number | null;
  /** Never null — unpriced work is $0 profit (cost-only), not unknown profit. */
  profit: number;
  /**
   * M50: why `cost` is what it is. "salary" and "unpriced" both leave nothing
   * in the hourly cost column but mean opposite things — one is accounted for
   * elsewhere, the other is missing data — and the report has to say which.
   */
  costBasis: "hourly" | "salary" | "unpriced";
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
 * M51 — the two sides of the equation now use **different** hours, which
 * reverses M48's original call, deliberately and on the product owner's
 * explicit instruction after being shown the conflict:
 *
 *   - **cost** is `actualHours x payRate`. The VA is paid for the time they
 *     actually worked.
 *   - **revenue** is `billedHours x invoiceRate`. The client is charged the
 *     uplifted, rounded-up figure.
 *
 * The gap between them is no longer an accounting artefact to be reconciled
 * away — under M51 it *is* the margin the uplift exists to create. M48 had
 * both sides on the rounded figure because the source workbook paid VAs on
 * the hours it invoiced (Vellih's 6.25h on Kim Wasley: $50.50 paid at $8.08,
 * $93.75 invoiced at $15.00). That tie-out no longer holds, so a report run
 * today over a past period will not match a copy of the workbook printed
 * back then. That was accepted when M51 was specified.
 *
 * Revenue requires all three of: a billable entry, a category that is
 * actually chargeable, and a resolved rate. Internal work therefore lands
 * as cost-only with zero profit rather than being dropped — its wages
 * still have to show up somewhere for the totals to mean anything.
 *
 * M50: a salaried member's hours cost nothing *here*. Their real cost is a
 * fixed weekly figure that has no relationship to hours logged, so it is
 * charged once per week in the report's salary block. Billing it per entry as
 * well would count the same payroll twice.
 */
export function grossProfitForEntry(
  entry: { seconds: number; billable: boolean; serviceCategory: CasualServiceCategory | null },
  opts: {
    payRate: number | null;
    invoiceRate: number | null;
    incrementHours: number;
    upliftPct: number;
    salaried: boolean;
  },
): EntryProfit {
  const actualHours = entry.seconds / 3600;
  const billedHours = billableHoursForCasualEntry(entry, entry.serviceCategory, {
    incrementHours: opts.incrementHours,
    upliftPct: opts.upliftPct,
  });

  const cost = opts.salaried ? 0 : opts.payRate === null ? null : actualHours * opts.payRate;

  // 'ironbrij' is casual work that is tracked but never charged — the same
  // exclusion billableHoursForCasualEntry already applies to its rounding.
  const chargeable = entry.billable && entry.serviceCategory !== "ironbrij";
  const revenue = chargeable && opts.invoiceRate !== null ? billedHours * opts.invoiceRate : null;

  return {
    actualHours,
    billedHours,
    cost,
    revenue,
    profit: revenue === null ? 0 : revenue - (cost ?? 0),
    costBasis: opts.salaried ? "salary" : opts.payRate === null ? "unpriced" : "hourly",
  };
}
