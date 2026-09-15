/** Days per year used to turn a monthly retainer into a daily rate. */
const DAYS_PER_YEAR = 365;

/** Parses a YYYY-MM-DD key to a UTC timestamp at midnight. */
const utcOf = (dateKey: string): number => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
};

/**
 * Inclusive day count between two date keys. Deliberately UTC-based:
 * dividing local-time millisecond differences breaks across a daylight
 * saving boundary, where a day is 23 or 25 hours long.
 */
const inclusiveDays = (fromKey: string, toKey: string): number => {
  const diff = (utcOf(toKey) - utcOf(fromKey)) / 86_400_000;
  return diff < 0 ? 0 : diff + 1;
};

export type PlacementAccrual = {
  /** Days the placement was live inside the range. 0 means it doesn't belong in the report at all. */
  days: number;
  cost: number;
  revenue: number;
  /** The management fee — revenue minus cost, and 0 when the placement isn't fully priced. */
  profit: number;
};

/**
 * M49: spreads a monthly retainer across a reporting range.
 *
 * The workbook prices placements per month, but Reports runs on arbitrary
 * ranges — a week, a month, a quarter. Daily accrual (`monthly × 12 ÷ 365`
 * per live day) was the confirmed convention: it handles part-months and
 * mid-range starts and ends correctly, where counting whole calendar
 * months would show a full month's fee on a one-week report.
 *
 * Only days the placement was actually live count. `endedOn` of null means
 * still live, so the range's own end bounds it. A placement that starts
 * after the range, or ended before it, accrues nothing.
 *
 * Both amounts are nullable because the sheet carries "N/A" pricing for
 * placements where the VA is paid but the client isn't on a package. Those
 * yield a $0 fee rather than a negative one — matching what the sheet
 * itself shows for those rows.
 */
export function retainerAccrualForRange(
  placement: {
    startedOn: string;
    endedOn: string | null;
    vaMonthlyRate: number | null;
    clientPackageAmount: number | null;
  },
  from: string,
  to: string,
): PlacementAccrual {
  const start = placement.startedOn > from ? placement.startedOn : from;
  const end = placement.endedOn !== null && placement.endedOn < to ? placement.endedOn : to;
  const days = inclusiveDays(start, end);

  if (days === 0) return { days: 0, cost: 0, revenue: 0, profit: 0 };

  const perDay = (monthly: number | null) =>
    monthly === null ? 0 : (monthly * 12 * days) / DAYS_PER_YEAR;

  const cost = perDay(placement.vaMonthlyRate);
  const revenue = perDay(placement.clientPackageAmount);

  return {
    days,
    cost,
    revenue,
    // Unpriced on either side means no fee to claim, not a negative one.
    profit:
      placement.vaMonthlyRate === null || placement.clientPackageAmount === null
        ? 0
        : revenue - cost,
  };
}
