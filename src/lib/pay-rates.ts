import type { WorkspaceEmployment } from "@/lib/workspace/types";

/**
 * Team pay with start dates (decided 2026-10-30). Each change to someone's
 * pay is a row that applies from its date until the next one, so a raise
 * leaves every week before it as it was. A row is an hourly rate, a weekly
 * salary, or neither: "no pay from this date", which is how a leaver's
 * salary stops. Rows live in member_pay_rates; all dates are YYYY-MM-DD.
 */

/** The date a pay row gets when it has applied for as long as anyone knows: shown as "From the start". */
export const PAY_FROM_THE_START = "2000-01-01";

export type PayRateRow = {
  /** The member_pay_rates row; absent for history built from member_employment. */
  id?: string;
  userId: string;
  effectiveFrom: string;
  hourlyRate: number | null;
  weeklySalary: number | null;
};

export type PayOnDate = { hourlyRate: number | null; weeklySalary: number | null };

const NO_PAY: PayOnDate = { hourlyRate: null, weeklySalary: null };
const DAYS_PER_WEEK = 7;

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The pay in effect on `date`: the latest change on or before it. No change yet means no pay. */
export function payOn(history: PayRateRow[], date: string): PayOnDate {
  let current: PayRateRow | undefined;
  for (const r of history) {
    if (r.effectiveFrom <= date && (!current || r.effectiveFrom > current.effectiveFrom)) {
      current = r;
    }
  }
  return current ? { hourlyRate: current.hourlyRate, weeklySalary: current.weeklySalary } : NO_PAY;
}

/**
 * What someone's salary costs from `from` to `to`, both included: a seventh
 * of the weekly salary in effect on each day, so a raise or a leaving date
 * mid-week splits the week. `days` counts the days a salary applied.
 */
export function salaryForRange(
  history: PayRateRow[],
  from: string,
  to: string,
): { days: number; salary: number } {
  let days = 0;
  let salary = 0;
  if (!history.some((r) => r.weeklySalary !== null)) return { days, salary };
  for (let d = from; d <= to; d = nextDay(d)) {
    const weeklySalary = payOn(history, d).weeklySalary;
    if (weeklySalary === null) continue;
    days += 1;
    salary += weeklySalary / DAYS_PER_WEEK;
  }
  return { days, salary };
}

/**
 * Someone's pay history from the single figures member_employment held
 * before pay had dates. The same rules seeded member_pay_rates, so every
 * past figure comes out as it did; also the fallback while that table can't
 * be read. A salaried person's hourly rate is left out because a salaried
 * person's time never cost anything per hour.
 */
export function payHistoryFromEmployment(
  e: Pick<
    WorkspaceEmployment,
    "userId" | "hourlyRate" | "weeklySalary" | "salaryFrom" | "salaryTo"
  >,
): PayRateRow[] {
  if (e.weeklySalary !== null && e.salaryFrom !== null) {
    const rows: PayRateRow[] = [
      {
        userId: e.userId,
        effectiveFrom: e.salaryFrom,
        hourlyRate: null,
        weeklySalary: e.weeklySalary,
      },
    ];
    if (e.salaryTo !== null) {
      rows.push({
        userId: e.userId,
        effectiveFrom: nextDay(e.salaryTo),
        hourlyRate: null,
        weeklySalary: null,
      });
    }
    return rows;
  }
  if (e.hourlyRate !== null) {
    return [
      {
        userId: e.userId,
        effectiveFrom: PAY_FROM_THE_START,
        hourlyRate: e.hourlyRate,
        weeklySalary: null,
      },
    ];
  }
  return [];
}

/** Each person's pay history, oldest change first. */
export function groupPayHistory(rows: PayRateRow[]): Map<string, PayRateRow[]> {
  const byUser = new Map<string, PayRateRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  for (const list of byUser.values()) {
    list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
  return byUser;
}
