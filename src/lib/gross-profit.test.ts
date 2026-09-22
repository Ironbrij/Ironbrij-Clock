// M48: unit coverage for the two business rules this feature adds that are
// easy to silently break — which rate wins when several apply, and which
// hours each side of the margin is computed on. Same scoped pure-function
// reasoning casual-billing.test.ts and time-utils.test.ts already give.
//
// M51: the second of those rules changed. Cost is now computed on actual
// tracked hours while revenue is computed on uplifted, rounded hours, so
// the "same hours both sides" assertions below became "different hours,
// and here is exactly which".
import { describe, expect, it } from "vitest";
import { grossProfitForEntry, resolveInvoiceRate, type BillingRate } from "./gross-profit";

const rate = (over: Partial<BillingRate>): BillingRate => ({
  clientId: "client-a",
  userId: null,
  hourlyRate: 15,
  effectiveFrom: "2026-01-01",
  ...over,
});

describe("resolveInvoiceRate", () => {
  it("returns null when no rate exists for the client", () => {
    expect(resolveInvoiceRate([], "client-a", "va-1", "2026-09-07")).toBeNull();
  });

  it("returns null when every rate starts after the date in question", () => {
    const rates = [rate({ effectiveFrom: "2026-09-08" })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBeNull();
  });

  it("ignores rates belonging to a different client", () => {
    const rates = [rate({ clientId: "client-b", hourlyRate: 99 })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBeNull();
  });

  it("ignores a VA override belonging to a different VA", () => {
    const rates = [rate({ userId: "va-2", hourlyRate: 99 })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBeNull();
  });

  it("falls back to the client default when the VA has no override", () => {
    const rates = [rate({ hourlyRate: 15 })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBe(15);
  });

  it("prefers a VA override over the client default", () => {
    // The workbook bills Carol Stimpson at 18.68 via Jose but 17.59 via Carlo.
    const rates = [rate({ hourlyRate: 17.59 }), rate({ userId: "va-1", hourlyRate: 18.68 })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBe(18.68);
  });

  it("prefers a VA override even when the client default is more recent", () => {
    const rates = [
      rate({ hourlyRate: 17.59, effectiveFrom: "2026-09-01" }),
      rate({ userId: "va-1", hourlyRate: 18.68, effectiveFrom: "2026-01-01" }),
    ];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBe(18.68);
  });

  it("picks the latest rate that has already taken effect", () => {
    const rates = [
      rate({ hourlyRate: 17.59, effectiveFrom: "2026-01-01" }),
      rate({ hourlyRate: 18.68, effectiveFrom: "2026-08-01" }),
    ];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-09-07")).toBe(18.68);
  });

  it("keeps the older rate for a date before the newer one took effect", () => {
    // This is the whole point of effective dating — re-running July's
    // report after an August rate rise must still show July's rate.
    const rates = [
      rate({ hourlyRate: 17.59, effectiveFrom: "2026-01-01" }),
      rate({ hourlyRate: 18.68, effectiveFrom: "2026-08-01" }),
    ];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-07-31")).toBe(17.59);
  });

  it("treats a rate effective on exactly that date as applying", () => {
    const rates = [rate({ hourlyRate: 18.68, effectiveFrom: "2026-08-01" })];
    expect(resolveInvoiceRate(rates, "client-a", "va-1", "2026-08-01")).toBe(18.68);
  });
});

const entry = (over: Partial<Parameters<typeof grossProfitForEntry>[0]>) => ({
  seconds: 3600,
  billable: true,
  serviceCategory: null,
  ...over,
});

/** The workspace defaults: 20% client uplift, rounded up to 0.25h. */
const opts = (over: Partial<Parameters<typeof grossProfitForEntry>[1]> = {}) => ({
  payRate: 6,
  invoiceRate: 18,
  incrementHours: 0.25,
  upliftPct: 20,
  salaried: false,
  ...over,
});

const hours = (h: number) => h * 3600;

describe("grossProfitForEntry", () => {
  it("costs actual hours and invoices uplifted, rounded hours (M51)", () => {
    // 6.10h actual. Uplifted 7.32h, rounded up to 7.50h billed.
    // Cost 6.10 x $6 = $36.60. Revenue 7.50 x $18 = $135.00.
    const result = grossProfitForEntry(
      entry({ seconds: hours(6.1), serviceCategory: "paid_casual" }),
      opts(),
    );
    expect(result.actualHours).toBeCloseTo(6.1);
    expect(result.billedHours).toBeCloseTo(7.5);
    expect(result.cost).toBeCloseTo(36.6);
    expect(result.revenue).toBeCloseTo(135);
    expect(result.profit).toBeCloseTo(98.4);
  });

  it("puts the whole uplift into the margin, not into cost", () => {
    // The gap between the two hour figures is exactly what M51 exists to
    // create — it must never leak back into what the VA is paid.
    const withUplift = grossProfitForEntry(
      entry({ seconds: hours(4), serviceCategory: "paid_casual" }),
      opts(),
    );
    const withoutUplift = grossProfitForEntry(
      entry({ seconds: hours(4), serviceCategory: "paid_casual" }),
      opts({ upliftPct: 0 }),
    );
    expect(withUplift.cost).toBeCloseTo(withoutUplift.cost!);
    expect(withUplift.revenue).toBeGreaterThan(withoutUplift.revenue!);
  });

  it("leaves non-casual work billed at exactly its actual hours", () => {
    // M51's scope was confirmed as the three casual categories only, so
    // regular client work must show identical figures on both sides.
    const result = grossProfitForEntry(entry({ seconds: hours(1.7) }), opts());
    expect(result.actualHours).toBeCloseTo(1.7);
    expect(result.billedHours).toBeCloseTo(1.7);
    expect(result.cost).toBeCloseTo(10.2);
    expect(result.revenue).toBeCloseTo(30.6);
  });

  it("counts 'ironbrij' work as cost-only with zero profit", () => {
    // Internal work is tracked but never charged, so it carries wages and
    // no revenue — it must still appear, or the wage total stops tying out.
    const result = grossProfitForEntry(
      entry({ seconds: hours(2), serviceCategory: "ironbrij" }),
      opts(),
    );
    expect(result.billedHours).toBeCloseTo(2);
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("counts a non-billable entry as cost-only with zero profit", () => {
    const result = grossProfitForEntry(entry({ seconds: hours(2), billable: false }), opts());
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("counts an unpriced client as cost-only with zero profit", () => {
    const result = grossProfitForEntry(entry({ seconds: hours(2) }), opts({ invoiceRate: null }));
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("reports revenue with a null cost when the VA has no pay rate set", () => {
    // Distinct from a zero rate: nobody has entered one, so the margin is
    // revenue against an unknown cost rather than against nothing.
    const result = grossProfitForEntry(entry({ seconds: hours(2) }), opts({ payRate: null }));
    expect(result.cost).toBeNull();
    expect(result.revenue).toBeCloseTo(36);
    expect(result.profit).toBeCloseTo(36);
  });

  it("handles a zero-length entry", () => {
    const result = grossProfitForEntry(entry({ seconds: 0 }), opts());
    expect(result.actualHours).toBe(0);
    expect(result.billedHours).toBe(0);
    expect(result.cost).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.profit).toBe(0);
  });

  it("prices a sub-minute casual entry that M51 stopped rounding to a minute", () => {
    // 20 seconds actual. Cost is a rounding error; revenue is a full
    // increment, because that is the smallest unit the client is charged.
    const result = grossProfitForEntry(
      entry({ seconds: 20, serviceCategory: "paid_casual" }),
      opts(),
    );
    expect(result.actualHours).toBeCloseTo(20 / 3600);
    expect(result.billedHours).toBeCloseTo(0.25);
    expect(result.revenue).toBeCloseTo(4.5);
  });

  it("costs a salaried member's hours at zero, so payroll isn't charged twice", () => {
    // Their real cost is the fixed weekly figure the report's salary block
    // charges once per week; billing it per entry as well would double-count.
    const result = grossProfitForEntry(
      entry({ seconds: hours(2), serviceCategory: "paid_casual" }),
      opts({ salaried: true }),
    );
    expect(result.cost).toBe(0);
    expect(result.costBasis).toBe("salary");
    // Still invoiced on the uplifted hours — 2h -> 2.4h -> 2.5h.
    expect(result.billedHours).toBeCloseTo(2.5);
    expect(result.revenue).toBeCloseTo(45);
    expect(result.profit).toBeCloseTo(45);
  });

  it("distinguishes a salaried member from one with no rate on file", () => {
    // Both leave the hourly cost column empty, but one is accounted for
    // elsewhere and the other is missing data.
    const salaried = grossProfitForEntry(entry({}), opts({ payRate: null, salaried: true }));
    const unpriced = grossProfitForEntry(entry({}), opts({ payRate: null }));
    expect(salaried.costBasis).toBe("salary");
    expect(salaried.cost).toBe(0);
    expect(unpriced.costBasis).toBe("unpriced");
    expect(unpriced.cost).toBeNull();
  });
});
