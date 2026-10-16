import type { SubscriptionCycle, SubscriptionStatus } from "@/lib/workspace/types";

type Priced = {
  amount: number | null;
  currency: string;
  billingCycle: SubscriptionCycle;
  status: SubscriptionStatus;
};

/**
 * What a subscription costs per month: the amount for a monthly plan, a
 * twelfth of an annual one. Null for an "other" cycle (a one-off licence,
 * usage billing) or a missing amount — unknown, not free.
 */
export function monthlyEquivalent(s: Pick<Priced, "amount" | "billingCycle">): number | null {
  if (s.amount === null) return null;
  if (s.billingCycle === "monthly") return s.amount;
  if (s.billingCycle === "annual") return s.amount / 12;
  return null;
}

/**
 * Monthly spend on active subscriptions, one total per currency (sorted by
 * code). Currencies are never added together: there's no exchange rate here
 * to convert USD tools into AUD honestly.
 */
export function monthlyTotalsByCurrency(subs: Priced[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const s of subs) {
    if (s.status !== "active") continue;
    const monthly = monthlyEquivalent(s);
    if (monthly === null) continue;
    totals.set(s.currency, (totals.get(s.currency) ?? 0) + monthly);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
}
