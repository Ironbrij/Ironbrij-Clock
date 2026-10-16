import { weeksInRange } from "@/lib/weekly-salary";

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

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** Average weeks in a month: 52 weeks ÷ 12 months. */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Pricing model, since 2026-10-16: placed VAs are billed hourly on both
 * sides, the way the accounts team's "Weekly Financial" sheet does it. The VA
 * is paid hours × their hourly rate, the client is invoiced hours × the
 * placement's invoice rate, and the hours are what accounts entered for that
 * week in Billing → Placements, falling back to the contracted hours when
 * nothing was entered. LMT placements use the same maths with "hours" meaning
 * units (the sheet's $65 paid / $300 invoiced per unit).
 *
 * This replaced the monthly-package model of M49: a package spread across a
 * range over 365 days. The stored package now only seeded each placement's
 * invoice rate (20261016030000_hourly_placements.sql). Reports → Gross
 * Profit, Billing → Placements and the weekly report all price a placement
 * through the functions below, so they agree.
 */
type PricedPlacement = {
  startedOn: string;
  endedOn: string | null;
  /** What the VA is paid per hour (or per LMT unit). */
  vaHourlyRate: number | null;
  contractedWeeklyHours: number | null;
  /** What the client is invoiced per hour (or per LMT unit). */
  clientHourlyRate: number | null;
};

/**
 * A placement's monthly VA cost at contracted hours: rate × weekly hours ×
 * 52 ÷ 12. Null when either is missing — the sheet's "N/A" rows — meaning
 * the cost is unknown, not zero.
 */
export function vaMonthlyCost(placement: {
  vaHourlyRate: number | null;
  contractedWeeklyHours: number | null;
}): number | null {
  if (placement.vaHourlyRate === null || placement.contractedWeeklyHours === null) return null;
  return placement.vaHourlyRate * placement.contractedWeeklyHours * WEEKS_PER_MONTH;
}

/** What the client is invoiced in a month at contracted hours. Null when unpriced. */
export function clientMonthlyRevenue(placement: {
  clientHourlyRate: number | null;
  contractedWeeklyHours: number | null;
}): number | null {
  if (placement.clientHourlyRate === null || placement.contractedWeeklyHours === null) return null;
  return placement.clientHourlyRate * placement.contractedWeeklyHours * WEEKS_PER_MONTH;
}

/**
 * The monthly management fee at contracted hours — derived, never stored, so
 * it can't drift from the rates it comes from. An unpriced side yields 0
 * rather than a negative fee, matching what the sheet shows for "N/A" rows.
 */
export function managementFee(placement: {
  vaHourlyRate: number | null;
  contractedWeeklyHours: number | null;
  clientHourlyRate: number | null;
}): number {
  const cost = vaMonthlyCost(placement);
  const revenue = clientMonthlyRevenue(placement);
  return cost === null || revenue === null ? 0 : revenue - cost;
}

export type PlacementWeekFigures = {
  /** Days the placement was live in the week, 0 to 7. 0 means it doesn't belong in that week at all. */
  days: number;
  /** The hours priced: entered for the week, else contracted (pro-rated). Null when neither exists. */
  hours: number | null;
  /** True when `hours` came from accounts' weekly entry rather than the contract. */
  hoursEntered: boolean;
  /** What the VA is paid for the week. Null when the rate or hours aren't set. */
  cost: number | null;
  /** What the client is invoiced for the week. Null when the invoice rate or hours aren't set. */
  revenue: number | null;
  /** Revenue minus cost, and 0 when either side is unpriced. */
  fee: number;
};

/**
 * One Monday-to-Sunday week of a placement: the sheet's row for that VA and
 * client. `enteredHours` is what accounts entered for the week, or null when
 * nothing was. Entered hours are that week's actual hours and are used as
 * they are; contracted hours are a full week's worth, so a placement that
 * starts or ends mid-week gets days ÷ 7 of them. Zero entered hours is a real
 * zero (the sheet shows VAs on leave at 0), not "use contracted".
 */
export function placementWeekFigures(
  placement: PricedPlacement,
  weekStart: string,
  enteredHours: number | null = null,
): PlacementWeekFigures {
  const weekEnd = new Date(utcOf(weekStart) + 6 * 86_400_000).toISOString().slice(0, 10);
  const start = later(placement.startedOn, weekStart);
  const end = placement.endedOn === null ? weekEnd : earlier(placement.endedOn, weekEnd);
  const days = inclusiveDays(start, end);

  if (days === 0) {
    return { days: 0, hours: 0, hoursEntered: false, cost: 0, revenue: 0, fee: 0 };
  }

  const hours =
    enteredHours !== null
      ? enteredHours
      : placement.contractedWeeklyHours === null
        ? null
        : (placement.contractedWeeklyHours * days) / 7;
  const cost =
    placement.vaHourlyRate === null || hours === null ? null : placement.vaHourlyRate * hours;
  const revenue =
    placement.clientHourlyRate === null || hours === null
      ? null
      : placement.clientHourlyRate * hours;

  return {
    days,
    hours,
    hoursEntered: enteredHours !== null,
    cost,
    revenue,
    fee: cost === null || revenue === null ? 0 : revenue - cost,
  };
}

export type PlacementRangeFigures = {
  /** Days the placement was live inside the range. 0 means it doesn't belong in the report at all. */
  days: number;
  cost: number;
  revenue: number;
  /** Revenue minus cost, counting only weeks priced on both sides. */
  profit: number;
};

/**
 * A placement across a reporting range, for Reports → Gross Profit: the sum
 * of its weeks, each from `placementWeekFigures`. A week the range only
 * partly covers counts the share of that week's live days that fall inside
 * the range — so a month that ends on a Wednesday takes 3/7 of that week's
 * hours, entered or contracted.
 *
 * Unpriced sides add nothing rather than counting as zero-cost or
 * zero-revenue, and a week only adds profit when both sides are priced: an
 * unpriced side isn't a loss, it's unknown.
 */
export function placementFiguresForRange(
  placement: PricedPlacement,
  from: string,
  to: string,
  hoursForWeek: (weekStart: string) => number | null,
): PlacementRangeFigures {
  const totals: PlacementRangeFigures = { days: 0, cost: 0, revenue: 0, profit: 0 };

  for (const week of weeksInRange(from, to)) {
    const figures = placementWeekFigures(placement, week.weekStart, hoursForWeek(week.weekStart));
    if (figures.days === 0) continue;

    const liveFrom = later(placement.startedOn, week.from);
    const liveTo = placement.endedOn === null ? week.to : earlier(placement.endedOn, week.to);
    const daysInRange = inclusiveDays(liveFrom, liveTo);
    if (daysInRange === 0) continue;

    const share = daysInRange / figures.days;
    totals.days += daysInRange;
    totals.cost += (figures.cost ?? 0) * share;
    totals.revenue += (figures.revenue ?? 0) * share;
    totals.profit += figures.fee * share;
  }

  return totals;
}
