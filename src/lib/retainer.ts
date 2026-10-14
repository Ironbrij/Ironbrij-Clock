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

/** Average weeks in a month: 52 weeks ÷ 12 months. */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * A placement's monthly VA cost. Since 2026-10-11 a VA's rate is set per
 * hour, and placed VAs log no time in IronTrack, so the cost comes from
 * their contracted hours: rate × weekly hours × 52 ÷ 12. Null when either
 * is missing — the sheet's "N/A" rows — meaning the cost is unknown, not
 * zero.
 */
export function vaMonthlyCost(placement: {
  vaHourlyRate: number | null;
  contractedWeeklyHours: number | null;
}): number | null {
  if (placement.vaHourlyRate === null || placement.contractedWeeklyHours === null) return null;
  return placement.vaHourlyRate * placement.contractedWeeklyHours * WEEKS_PER_MONTH;
}

/**
 * M49: the management fee — derived, never stored, so it can't drift from
 * the amounts it comes from. An unpriced side yields 0 rather than a
 * negative fee, matching what the source sheet shows for its "N/A" rows.
 */
export function managementFee(placement: {
  vaHourlyRate: number | null;
  contractedWeeklyHours: number | null;
  clientPackageAmount: number | null;
}): number {
  const cost = vaMonthlyCost(placement);
  return cost === null || placement.clientPackageAmount === null
    ? 0
    : placement.clientPackageAmount - cost;
}

export type PlacementAccrual = {
  /** Days the placement was live inside the range. 0 means it doesn't belong in the report at all. */
  days: number;
  cost: number;
  revenue: number;
  /** The management fee — revenue minus cost, and 0 when the placement isn't fully priced. */
  profit: number;
};

/**
 * M49: spreads a monthly retainer across a reporting range. The VA side is
 * the monthly cost from `vaMonthlyCost` (hourly rate × contracted hours).
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
    vaHourlyRate: number | null;
    contractedWeeklyHours: number | null;
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

  const monthlyCost = vaMonthlyCost(placement);
  const cost = perDay(monthlyCost);
  const revenue = perDay(placement.clientPackageAmount);

  return {
    days,
    cost,
    revenue,
    // Unpriced on either side means no fee to claim, not a negative one.
    profit: monthlyCost === null || placement.clientPackageAmount === null ? 0 : revenue - cost,
  };
}

export type PlacementWeekFigures = {
  /** Days the placement was live in the week, 0 to 7. 0 means it doesn't belong in that week at all. */
  days: number;
  /** What the VA is paid for the week. Null when the rate or hours aren't set. */
  cost: number | null;
  /** The client's package for the week. Null when the client isn't on a package. */
  revenue: number | null;
  /** Revenue minus cost, and 0 when either side is unpriced. */
  fee: number;
};

/**
 * One Monday-to-Sunday week of a placement, for Billing → Placements' "week
 * covered" filter. VAs are paid weekly, so a full week's cost is exactly
 * hourly rate × contracted hours, and the package is its monthly price × 12
 * ÷ 52. A placement that starts or ends mid-week counts only the days it was
 * live (× days ÷ 7).
 *
 * Deliberately not `retainerAccrualForRange`, whose 365-day accrual makes a
 * full week about 0.3% lower ($797.81 rather than $800 for $20 × 40h).
 * Reports → Gross Profit keeps that convention: the user chose on 2026-10-14
 * not to shift figures already reported.
 */
export function placementWeekFigures(
  placement: {
    startedOn: string;
    endedOn: string | null;
    vaHourlyRate: number | null;
    contractedWeeklyHours: number | null;
    clientPackageAmount: number | null;
  },
  weekStart: string,
): PlacementWeekFigures {
  const weekEnd = new Date(utcOf(weekStart) + 6 * 86_400_000).toISOString().slice(0, 10);
  const start = placement.startedOn > weekStart ? placement.startedOn : weekStart;
  const end =
    placement.endedOn !== null && placement.endedOn < weekEnd ? placement.endedOn : weekEnd;
  const days = inclusiveDays(start, end);

  if (days === 0) return { days: 0, cost: 0, revenue: 0, fee: 0 };

  const share = days / 7;
  const cost =
    placement.vaHourlyRate === null || placement.contractedWeeklyHours === null
      ? null
      : placement.vaHourlyRate * placement.contractedWeeklyHours * share;
  const revenue =
    placement.clientPackageAmount === null
      ? null
      : (placement.clientPackageAmount / WEEKS_PER_MONTH) * share;

  return {
    days,
    cost,
    revenue,
    fee: cost === null || revenue === null ? 0 : revenue - cost,
  };
}
