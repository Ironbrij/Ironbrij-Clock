// M48: unit coverage for the two business rules this feature adds that are
// easy to silently break — which rate wins when several apply, and which
// hours each side of the margin is computed on. Same scoped pure-function
// reasoning casual-billing.test.ts and time-utils.test.ts already give.
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
  minutes: 60,
  billable: true,
  serviceCategory: null,
  ...over,
});

describe("grossProfitForEntry", () => {
  it("computes cost, revenue and profit from the same rounded hours", () => {
    // 100 minutes = 1.6667h -> 1.75h at a 0.25h increment. Both sides use 1.75.
    const result = grossProfitForEntry(entry({ minutes: 100, serviceCategory: "paid_casual" }), {
      payRate: 6,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.hours).toBeCloseTo(1.75);
    expect(result.cost).toBeCloseTo(10.5);
    expect(result.revenue).toBeCloseTo(31.5);
    expect(result.profit).toBeCloseTo(21);
  });

  it("reproduces a real line from the CS Profit sheet", () => {
    // Jose -> Carol Stimpson, week of Sep 7 2026: 19.25h at $6.00 paid and
    // $18.68 invoiced. Hours are already an exact increment multiple here.
    const result = grossProfitForEntry(
      entry({ minutes: 19.25 * 60, serviceCategory: "paid_casual" }),
      { payRate: 6, invoiceRate: 18.68, incrementHours: 0.25 },
    );
    expect(result.cost).toBeCloseTo(115.5);
    expect(result.revenue).toBeCloseTo(359.59);
    expect(result.profit).toBeCloseTo(244.09);
  });

  it("leaves a non-casual entry's hours unrounded", () => {
    const result = grossProfitForEntry(entry({ minutes: 100 }), {
      payRate: 6,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.hours).toBeCloseTo(100 / 60);
  });

  it("counts 'ironbrij' work as cost-only with zero profit", () => {
    // Internal work is tracked but never charged, so it carries wages and
    // no revenue — it must still appear, or the wage total stops tying out.
    const result = grossProfitForEntry(entry({ minutes: 120, serviceCategory: "ironbrij" }), {
      payRate: 6,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("counts a non-billable entry as cost-only with zero profit", () => {
    const result = grossProfitForEntry(entry({ minutes: 120, billable: false }), {
      payRate: 6,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("counts an unpriced client as cost-only with zero profit", () => {
    const result = grossProfitForEntry(entry({ minutes: 120 }), {
      payRate: 6,
      invoiceRate: null,
      incrementHours: 0.25,
    });
    expect(result.cost).toBeCloseTo(12);
    expect(result.revenue).toBeNull();
    expect(result.profit).toBe(0);
  });

  it("reports revenue with a null cost when the VA has no pay rate set", () => {
    // Distinct from a zero rate: nobody has entered one, so the margin is
    // revenue against an unknown cost rather than against nothing.
    const result = grossProfitForEntry(entry({ minutes: 120 }), {
      payRate: null,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.cost).toBeNull();
    expect(result.revenue).toBeCloseTo(36);
    expect(result.profit).toBeCloseTo(36);
  });

  it("handles a zero-minute entry", () => {
    const result = grossProfitForEntry(entry({ minutes: 0 }), {
      payRate: 6,
      invoiceRate: 18,
      incrementHours: 0.25,
    });
    expect(result.hours).toBe(0);
    expect(result.cost).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.profit).toBe(0);
  });
});
