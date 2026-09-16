// M50: unit coverage for the two rules this feature rests on — that a whole
// week charges exactly the salary the accounts team reads off their workbook,
// and that a leaver stops being charged. Same scoped pure-function reasoning
// retainer.test.ts and gross-profit.test.ts already give.
import { describe, expect, it } from "vitest";
import { salaryAccrualForWeek, weeksInRange, type SalaryWeek } from "./weekly-salary";

const employment = (over: Partial<Parameters<typeof salaryAccrualForWeek>[0]> = {}) => ({
  weeklySalary: 811.36,
  salaryFrom: "2020-01-01",
  salaryTo: null,
  ...over,
});

// 2026-09-07 is a Monday.
const fullWeek: SalaryWeek = {
  weekStart: "2026-09-07",
  from: "2026-09-07",
  to: "2026-09-13",
  days: 7,
};

describe("weeksInRange", () => {
  it("returns one whole week for an exact Monday-to-Sunday range", () => {
    expect(weeksInRange("2026-09-07", "2026-09-13")).toEqual([fullWeek]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(weeksInRange("2026-09-13", "2026-09-07")).toEqual([]);
  });

  it("gives a single one-day week for a single-day range", () => {
    const weeks = weeksInRange("2026-09-09", "2026-09-09");
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ weekStart: "2026-09-07", days: 1 });
  });

  it("clips a range that starts mid-week, then runs whole weeks", () => {
    // Wednesday 2026-09-09 through Sunday 2026-09-20.
    const weeks = weeksInRange("2026-09-09", "2026-09-20");
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toEqual({
      weekStart: "2026-09-07",
      from: "2026-09-09",
      to: "2026-09-13",
      days: 5,
    });
    expect(weeks[1]).toEqual({
      weekStart: "2026-09-14",
      from: "2026-09-14",
      to: "2026-09-20",
      days: 7,
    });
  });

  it("clips a trailing partial week", () => {
    const weeks = weeksInRange("2026-09-07", "2026-09-16");
    expect(weeks).toHaveLength(2);
    expect(weeks[1]).toEqual({
      weekStart: "2026-09-14",
      from: "2026-09-14",
      to: "2026-09-16",
      days: 3,
    });
  });

  it("still yields 7-day weeks across a daylight saving boundary", () => {
    // Australian DST starts on the first Sunday of October.
    for (const week of weeksInRange("2026-09-28", "2026-10-11")) {
      expect(week.days).toBe(7);
    }
  });
});

describe("salaryAccrualForWeek", () => {
  it("charges the exact weekly figure for a whole week", () => {
    // The point of dividing by 7 rather than annualising: this must not be
    // 809.14, which is what monthly-style 12/365 accrual would produce.
    expect(salaryAccrualForWeek(employment(), fullWeek).salary).toBeCloseTo(811.36, 2);
  });

  it("prorates a partial week by its days", () => {
    const partial: SalaryWeek = {
      weekStart: "2026-09-07",
      from: "2026-09-07",
      to: "2026-09-09",
      days: 3,
    };
    const accrual = salaryAccrualForWeek(employment(), partial);
    expect(accrual.days).toBe(3);
    expect(accrual.salary).toBeCloseTo((811.36 * 3) / 7, 2);
  });

  it("charges nothing before the salary starts", () => {
    const accrual = salaryAccrualForWeek(employment({ salaryFrom: "2026-10-01" }), fullWeek);
    expect(accrual).toEqual({ days: 0, salary: 0 });
  });

  it("charges nothing after the salary ends", () => {
    const accrual = salaryAccrualForWeek(employment({ salaryTo: "2026-08-31" }), fullWeek);
    expect(accrual).toEqual({ days: 0, salary: 0 });
  });

  it("truncates the week a leaver departs in, leaving whole weeks alone", () => {
    // Left on the Wednesday: Mon, Tue, Wed = 3 days.
    const accrual = salaryAccrualForWeek(employment({ salaryTo: "2026-09-09" }), fullWeek);
    expect(accrual.days).toBe(3);
    expect(accrual.salary).toBeCloseTo((811.36 * 3) / 7, 2);
  });

  it("treats a null end date as still employed", () => {
    expect(salaryAccrualForWeek(employment({ salaryTo: null }), fullWeek).days).toBe(7);
  });

  it("charges nothing when the member has no salary set", () => {
    expect(salaryAccrualForWeek(employment({ weeklySalary: null }), fullWeek)).toEqual({
      days: 0,
      salary: 0,
    });
  });

  it("charges nothing when an amount somehow has no start date", () => {
    expect(salaryAccrualForWeek(employment({ salaryFrom: null }), fullWeek)).toEqual({
      days: 0,
      salary: 0,
    });
  });
});
