import { addDays, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";

/**
 * Days per week used to prorate a salary.
 *
 * Deliberately 7, not the 12/365 annualisation retainer.ts uses. A *month*
 * has no fixed day count, so a monthly retainer genuinely has to be
 * annualised. A week is always 7 days, so annualising a weekly figure would
 * only inject a 0.27% error — the Creatives team's $811.36 would print as
 * $809.14, and the accounts team reads that number as exact.
 */
const DAYS_PER_WEEK = 7;

/** Parses a YYYY-MM-DD key to a UTC timestamp at midnight. */
const utcOf = (dateKey: string): number => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
};

/**
 * Inclusive day count between two date keys. UTC-based for the same reason
 * retainer.ts is: dividing local-time millisecond differences breaks across a
 * daylight saving boundary, where a day is 23 or 25 hours long.
 */
const inclusiveDays = (fromKey: string, toKey: string): number => {
  const diff = (utcOf(toKey) - utcOf(fromKey)) / 86_400_000;
  return diff < 0 ? 0 : diff + 1;
};

export type SalaryWeek = {
  /** Monday of this week, as a date key. Also the grouping key for entries. */
  weekStart: string;
  /** First day of the week that falls inside the report range. */
  from: string;
  /** Last day of the week that falls inside the report range. */
  to: string;
  /** Days of this week inside the range — 7 for a whole week, fewer at either end. */
  days: number;
};

/**
 * M50: the Monday-started weeks a report range touches, each clipped to the
 * range itself.
 *
 * The Gross Profit report runs on arbitrary ranges but the salary question is
 * inherently weekly ("did casual work cover payroll this week"), so the range
 * is cut into weeks rather than prorated as one lump. Weeks are Monday-based
 * to match startOfWeek, which every other week view in the app already uses.
 *
 * A range starting or ending mid-week yields a short week rather than being
 * rounded out to a whole one — the caller shows `days` so a short week reads
 * as short instead of looking like a payroll discrepancy.
 */
export function weeksInRange(from: string, to: string): SalaryWeek[] {
  if (from > to) return [];

  const weeks: SalaryWeek[] = [];
  let cursor = startOfWeek(fromDateKey(from));

  for (;;) {
    const weekStart = toDateKey(cursor);
    if (weekStart > to) return weeks;

    const weekEnd = toDateKey(addDays(cursor, DAYS_PER_WEEK - 1));
    const clippedFrom = weekStart > from ? weekStart : from;
    const clippedTo = weekEnd < to ? weekEnd : to;

    weeks.push({
      weekStart,
      from: clippedFrom,
      to: clippedTo,
      days: inclusiveDays(clippedFrom, clippedTo),
    });

    cursor = addDays(cursor, DAYS_PER_WEEK);
  }
}

export type SalaryAccrual = {
  /** Days of the week the member was actually salaried. 0 means they don't belong in that week. */
  days: number;
  salary: number;
};

/**
 * What one member's fixed salary costs inside one week.
 *
 * A salary accrues in weeks where the member logged no time at all, which is
 * exactly why salaryFrom/salaryTo exist: without them a member who left would
 * keep drawing payroll in every report forever. Clipping also keeps a leaver's
 * past weeks at their real cost, where blanking the amount would rewrite them
 * to zero.
 *
 * salaryTo of null means still employed, so the week's own end bounds it —
 * same shape as retainerAccrualForRange's endedOn.
 */
export function salaryAccrualForWeek(
  employment: { weeklySalary: number | null; salaryFrom: string | null; salaryTo: string | null },
  week: SalaryWeek,
): SalaryAccrual {
  // The DB requires a start whenever an amount is set; this guards the case
  // where a caller hands us a partially-filled record anyway.
  if (employment.weeklySalary === null || employment.salaryFrom === null) {
    return { days: 0, salary: 0 };
  }

  const start = employment.salaryFrom > week.from ? employment.salaryFrom : week.from;
  const end =
    employment.salaryTo !== null && employment.salaryTo < week.to ? employment.salaryTo : week.to;
  const days = inclusiveDays(start, end);

  if (days === 0) return { days: 0, salary: 0 };

  return { days, salary: (employment.weeklySalary * days) / DAYS_PER_WEEK };
}
