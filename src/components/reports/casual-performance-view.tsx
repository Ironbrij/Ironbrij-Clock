// Presentation only: every figure is computed in Reports() (with the maths
// in lib/casual-performance.ts) and passed in. The accounts workbook's
// WEEKLY DASHBOARD layout: headline figures, weekly performance against the
// period before, then hours per VA per category.
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type CasualHours, periodChange } from "@/lib/casual-performance";
import { STAFF_TYPE_LABELS, type StaffType } from "@/lib/workspace/types";

export type PerformanceSortKey = "name" | "type" | keyof CasualHours;

export type CasualPerformanceRow = {
  userId: string;
  name: string;
  staffType: StaffType;
  hours: CasualHours;
};

/** The category columns, in the sheet's order. */
const COLUMNS: { key: keyof CasualHours; label: string }[] = [
  { key: "paid_casual", label: "Paid Casual" },
  { key: "promotional", label: "Promotional" },
  { key: "vip_client", label: "VIP Client" },
  { key: "ironbrij", label: "Ironbrij" },
  { key: "total", label: "Total" },
];

/** The weekly-performance rows, in the sheet's order. */
const METRICS: { key: keyof CasualHours; label: string }[] = [
  { key: "total", label: "Casual hours (all four)" },
  { key: "ironbrij", label: "Ironbrij" },
  { key: "paid_casual", label: "Paid Casual" },
  { key: "vip_client", label: "VIP Client" },
  { key: "promotional", label: "Promotional" },
];

// Decimal hours, like the sheet, so figures can be checked against it.
const hrs = (h: number) => h.toFixed(2);
const signed = (n: number, digits: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;
const trendClass = (n: number) =>
  n > 0 ? "text-emerald-600 dark:text-emerald-400" : n < 0 ? "text-destructive" : "";

export function CasualPerformanceView({
  rangeLabel,
  previousLabel,
  from,
  to,
  current,
  previous,
  previousTruncated,
  paidCasualActual,
  top,
  rows,
  sortKey,
  sortAsc,
  onSort,
}: {
  rangeLabel: string;
  previousLabel: string;
  /** The range, for the links into each person's History breakdown. */
  from: string;
  to: string;
  current: CasualHours;
  /** Null while the earlier period loads, or if it couldn't be loaded. */
  previous: CasualHours | null;
  previousTruncated: boolean;
  paidCasualActual: number;
  top: { name: string; hours: number } | null;
  rows: CasualPerformanceRow[];
  sortKey: PerformanceSortKey;
  sortAsc: boolean;
  onSort: (key: PerformanceSortKey) => void;
}) {
  const totalChange = previous ? periodChange(current.total, previous.total) : null;
  const increment = current.paid_casual - paidCasualActual;

  const sortHeader = (key: PerformanceSortKey, label: string, numeric: boolean) => (
    <th
      className={`px-4 py-2.5 font-medium ${numeric ? "text-right" : ""}`}
      aria-sort={sortKey === key ? (sortAsc ? "ascending" : "descending") : undefined}
    >
      <button type="button" onClick={() => onSort(key)} className="hover:text-foreground">
        {label}
        <span aria-hidden="true">{sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}</span>
      </button>
    </th>
  );

  return (
    <section className="mb-8 space-y-4" aria-labelledby="casual-performance-heading">
      <div>
        <h2 id="casual-performance-heading" className="text-base font-semibold">
          Casual services performance · {rangeLabel}
        </h2>
        <p className="text-xs text-muted-foreground">
          Every casual category, for the date range and team filter only. Paid Casual is in hours
          after increments, as in the accounts sheet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Casual hours
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{hrs(current.total)}</p>
            {totalChange?.pct != null && (
              <p className={`mt-1 text-sm ${trendClass(totalChange.difference)}`}>
                {signed(totalChange.pct, 1)}% vs {previousLabel}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top VA, Paid Casual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="truncate text-3xl font-semibold">{top?.name ?? "—"}</p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {top ? `${hrs(top.hours)} hrs` : "No Paid Casual work in this range"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Paid Casual, actual → after increments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {hrs(paidCasualActual)} → {hrs(current.paid_casual)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {signed(increment, 2)} hrs added by increments
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Weekly performance</CardTitle>
          <p className="text-xs text-muted-foreground">
            {rangeLabel} compared with {previousLabel}
          </p>
          {previousTruncated && (
            <p className="text-xs text-destructive">
              The earlier period has too many entries to load in full, so its figures are short.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Hours</th>
                  <th className="px-4 py-2.5 text-right font-medium">This period</th>
                  <th className="px-4 py-2.5 text-right font-medium">Period before</th>
                  <th className="px-4 py-2.5 text-right font-medium">Difference</th>
                  <th className="px-4 py-2.5 text-right font-medium">% change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {METRICS.map(({ key, label }) => {
                  const change = previous ? periodChange(current[key], previous[key]) : null;
                  return (
                    <tr key={key}>
                      <td className="px-4 py-2.5">{label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{hrs(current[key])}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {previous ? hrs(previous[key]) : "…"}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${change ? trendClass(change.difference) : ""}`}
                      >
                        {change ? signed(change.difference, 2) : "…"}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${change ? trendClass(change.difference) : ""}`}
                      >
                        {change ? (change.pct === null ? "—" : `${signed(change.pct, 1)}%`) : "…"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">By VA</CardTitle>
          <p className="text-xs text-muted-foreground">
            Type is set per person in Manage → Schedule. Click a name to see their week in History.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No casual hours logged in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-border text-xs text-muted-foreground">
                  <tr>
                    {sortHeader("name", "VA", false)}
                    {sortHeader("type", "Type", false)}
                    {COLUMNS.map((c) => sortHeader(c.key, c.label, true))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td className="px-4 py-2.5 font-medium">
                        <Link
                          to="/history"
                          search={{
                            view: "breakdown",
                            person: r.userId,
                            range: "custom",
                            from,
                            to,
                          }}
                          className="hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {STAFF_TYPE_LABELS[r.staffType]}
                      </td>
                      {COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className={`px-4 py-2.5 text-right tabular-nums ${c.key === "total" ? "font-medium" : ""}`}
                        >
                          {hrs(r.hours[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-semibold">
                  <tr>
                    <td className="px-4 py-2.5">Total</td>
                    <td />
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-2.5 text-right tabular-nums">
                        {hrs(current[c.key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
