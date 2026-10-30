import { describe, expect, it } from "vitest";
import {
  PAY_FROM_THE_START,
  groupPayHistory,
  hourlyPayForEntries,
  payChangeOn,
  payHistoryFromEmployment,
  payOn,
  salaryForRange,
  type PayRateRow,
} from "./pay-rates";

const row = (
  effectiveFrom: string,
  pay: { hourlyRate?: number; weeklySalary?: number } = {},
): PayRateRow => ({
  userId: "u1",
  effectiveFrom,
  hourlyRate: pay.hourlyRate ?? null,
  weeklySalary: pay.weeklySalary ?? null,
});

describe("payOn", () => {
  const history = [
    row("2026-11-02", { hourlyRate: 6.5 }),
    row(PAY_FROM_THE_START, { hourlyRate: 6 }),
  ];

  it("uses the rate in effect on the day, so a raise only counts from its date", () => {
    expect(payOn(history, "2026-11-01")).toEqual({ hourlyRate: 6, weeklySalary: null });
    expect(payOn(history, "2026-11-02")).toEqual({ hourlyRate: 6.5, weeklySalary: null });
  });

  it("has no pay before the first change, or with no history", () => {
    expect(payOn([row("2026-11-02", { hourlyRate: 6.5 })], "2026-11-01")).toEqual({
      hourlyRate: null,
      weeklySalary: null,
    });
    expect(payOn([], "2026-11-01")).toEqual({ hourlyRate: null, weeklySalary: null });
  });
});

describe("salaryForRange", () => {
  const week = ["2026-10-19", "2026-10-25"] as const;

  it("is the weekly salary for a full week", () => {
    expect(salaryForRange([row("2026-10-01", { weeklySalary: 700 })], ...week)).toEqual({
      days: 7,
      salary: 700,
    });
  });

  it("splits a week at a mid-week raise, by day", () => {
    const history = [
      row("2026-10-01", { weeklySalary: 700 }),
      row("2026-10-21", { weeklySalary: 770 }),
    ];
    expect(salaryForRange(history, ...week)).toEqual({ days: 7, salary: 750 });
  });

  it("stops at a No pay change", () => {
    const history = [row("2026-10-01", { weeklySalary: 700 }), row("2026-10-24")];
    expect(salaryForRange(history, ...week)).toEqual({ days: 5, salary: 500 });
  });

  it("is nothing for someone paid by the hour", () => {
    expect(salaryForRange([row(PAY_FROM_THE_START, { hourlyRate: 6 })], ...week)).toEqual({
      days: 0,
      salary: 0,
    });
  });
});

describe("payHistoryFromEmployment", () => {
  const employment = {
    userId: "u1",
    hourlyRate: null,
    weeklySalary: null,
    salaryFrom: null,
    salaryTo: null,
  };

  it("makes an hourly rate apply from the start", () => {
    expect(payHistoryFromEmployment({ ...employment, hourlyRate: 6 })).toEqual([
      row(PAY_FROM_THE_START, { hourlyRate: 6 }),
    ]);
  });

  it("makes a salary apply from its start date, ignores the hourly rate, and ends it after salaryTo", () => {
    expect(
      payHistoryFromEmployment({
        ...employment,
        hourlyRate: 6,
        weeklySalary: 700,
        salaryFrom: "2026-09-01",
        salaryTo: "2026-09-30",
      }),
    ).toEqual([row("2026-09-01", { weeklySalary: 700 }), row("2026-10-01")]);
  });

  it("is empty when no pay is set", () => {
    expect(payHistoryFromEmployment(employment)).toEqual([]);
  });
});

describe("groupPayHistory", () => {
  it("groups by person, oldest change first", () => {
    const grouped = groupPayHistory([
      row("2026-11-02", { hourlyRate: 6.5 }),
      { ...row("2026-01-01", { hourlyRate: 8 }), userId: "u2" },
      row(PAY_FROM_THE_START, { hourlyRate: 6 }),
    ]);
    expect(grouped.get("u1")?.map((r) => r.effectiveFrom)).toEqual([
      PAY_FROM_THE_START,
      "2026-11-02",
    ]);
    expect(grouped.get("u2")).toHaveLength(1);
  });
});

describe("hourlyPayForEntries", () => {
  const history = [
    row(PAY_FROM_THE_START, { hourlyRate: 6 }),
    row("2026-11-02", { hourlyRate: 6.5 }),
  ];

  it("prices each entry at the rate in effect on its day", () => {
    expect(
      hourlyPayForEntries(history, [
        { date: "2026-11-01", seconds: 7200 },
        { date: "2026-11-02", seconds: 3600 },
      ]),
    ).toBe(18.5);
  });

  it("is null when no entry has a rate", () => {
    expect(hourlyPayForEntries([], [{ date: "2026-11-01", seconds: 3600 }])).toBeNull();
  });
});

describe("payChangeOn", () => {
  it("is the change in effect on the day, or null before any", () => {
    const history = [
      row(PAY_FROM_THE_START, { hourlyRate: 6 }),
      row("2026-11-02", { hourlyRate: 6.5 }),
    ];
    expect(payChangeOn(history, "2026-11-05")?.effectiveFrom).toBe("2026-11-02");
    expect(payChangeOn([row("2026-11-02")], "2026-11-01")).toBeNull();
  });
});
