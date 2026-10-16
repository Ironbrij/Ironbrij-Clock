import { describe, expect, it } from "vitest";
import { monthlyEquivalent, monthlyTotalsByCurrency } from "./subscriptions";

type Subscription = Parameters<typeof monthlyTotalsByCurrency>[0][number];
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  amount: 30,
  currency: "USD",
  billingCycle: "monthly" as const,
  status: "active" as const,
  ...over,
});

describe("monthlyEquivalent", () => {
  it("is the amount for a monthly plan and a twelfth of an annual one", () => {
    expect(monthlyEquivalent(sub())).toBe(30);
    expect(monthlyEquivalent(sub({ amount: 240, billingCycle: "annual" }))).toBe(20);
  });

  it("is unknown (null) for an 'other' cycle or a missing amount, not zero", () => {
    expect(monthlyEquivalent(sub({ billingCycle: "other" }))).toBeNull();
    expect(monthlyEquivalent(sub({ amount: null }))).toBeNull();
  });
});

describe("monthlyTotalsByCurrency", () => {
  it("adds active subscriptions per currency and never mixes currencies", () => {
    const totals = monthlyTotalsByCurrency([
      sub({ amount: 20 }),
      sub({ amount: 120, billingCycle: "annual" }),
      sub({ amount: 50, currency: "AUD" }),
    ]);
    expect(totals).toEqual([
      { currency: "AUD", amount: 50 },
      { currency: "USD", amount: 30 },
    ]);
  });

  it("leaves out cancelled subscriptions and ones it can't put a monthly figure on", () => {
    const totals = monthlyTotalsByCurrency([
      sub({ status: "cancelled" }),
      sub({ billingCycle: "other" }),
      sub({ amount: null }),
    ]);
    expect(totals).toEqual([]);
  });
});
