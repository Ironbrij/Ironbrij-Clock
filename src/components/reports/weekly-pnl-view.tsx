// Reports → Weekly P&L. Presentation only: every figure is computed in
// src/lib/weekly-financials.ts and handed over by Reports().
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/mock-data";
import { formatWeekRange, fromDateKey } from "@/lib/time-utils";
import {
  WEEKLY_DEPARTMENT_LABELS,
  type WeeklyDetailRow,
  type WeeklyFinancials,
  type WeeklyPnlRow,
} from "@/lib/weekly-financials";
import type { WorkspaceSettings } from "@/lib/workspace/types";
import { DETAILED_ENTRIES_LIMIT } from "@/lib/workspace-store";
import { formatCurrency } from "./report-config";

type WeeklyPnlViewProps = {
  weeks: WeeklyFinancials[];
  rows: WeeklyPnlRow[];
  selectedWeek: string | null;
  setSelectedWeek: (weekStart: string) => void;
  clientLabel: (clientId: string | null) => string;
  personLabel: (row: WeeklyDetailRow) => string;
  settings: WorkspaceSettings;
  truncated: boolean;
};

export function WeeklyPnlView({
  weeks,
  rows,
  selectedWeek,
  setSelectedWeek,
  clientLabel,
  personLabel,
  settings,
  truncated,
}: WeeklyPnlViewProps) {
  if (truncated) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        These weeks have more than {DETAILED_ENTRIES_LIMIT.toLocaleString()} time entries, so the
        weekly P&amp;L can&apos;t be worked out completely and isn&apos;t shown. Pick a shorter date
        range.
      </p>
    );
  }

  if (weeks.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Pick a date range to see its weeks.
      </p>
    );
  }

  const money = (n: number) => formatCurrency(n, settings.currency);
  const format = (row: WeeklyPnlRow, value: number | null) => {
    if (value === null) return "—";
    switch (row.format) {
      case "money":
        return money(value);
      case "pct":
        return `${value.toFixed(2)}%`;
      case "hours":
        return value.toFixed(2);
      default:
        return String(value);
    }
  };
  const week = weeks.find((w) => w.weekStart === selectedWeek) ?? weeks[weeks.length - 1];

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        The accounts team&apos;s weekly financial report, company-wide — the team, client and tag
        filters don&apos;t apply. Paid = hours × pay rate, invoiced = hours × invoice rate, profit =
        invoiced − paid. Placed VAs use the hours entered in Billing → Placements (else their
        contracted hours); the internal team&apos;s Paid Casual work is invoiced with the increment.
        &ldquo;Wages % of invoiced&rdquo; is the sheet&apos;s &ldquo;GP %&rdquo;. Pick a week to see
        its detail.
      </p>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 min-w-56 bg-card px-5 py-3 text-left font-medium">
                  Week
                </th>
                {weeks.map((w) => (
                  <th key={w.weekStart} className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      aria-pressed={w.weekStart === week.weekStart}
                      onClick={() => setSelectedWeek(w.weekStart)}
                      className={`whitespace-nowrap rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        w.weekStart === week.weekStart ? "bg-muted text-foreground" : ""
                      }`}
                    >
                      {formatWeekRange(fromDateKey(w.weekStart))}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className={`border-b border-border last:border-0 ${row.emphasis ? "bg-muted/40 font-semibold" : ""}`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 whitespace-nowrap px-5 py-2 text-left font-medium ${
                      row.emphasis ? "bg-muted" : "bg-card text-muted-foreground"
                    }`}
                  >
                    {row.label}
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={weeks[i].weekStart}
                      className={`whitespace-nowrap px-5 py-2 text-right ${
                        weeks[i].weekStart === week.weekStart ? "bg-muted/60" : ""
                      } ${row.format === "money" && value !== null && value < 0 ? "text-destructive" : ""}`}
                    >
                      {format(row, value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <h2 className="text-base font-semibold">
        {formatWeekRange(fromDateKey(week.weekStart))} — detail
      </h2>

      {week.departments.map((d) => (
        <Card key={d.key} className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-medium">
              <span>{WEEKLY_DEPARTMENT_LABELS[d.key]}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {d.clients} {d.clients === 1 ? "client" : "clients"} · {d.vas}{" "}
                {d.vas === 1 ? "VA" : "VAs"}
                {d.unpriced ? " · some work has no invoice rate" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {d.rows.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Nothing this week.</p>
            ) : (
              <table className="w-full min-w-[900px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Client</th>
                    <th className="px-5 py-3 text-left font-medium">VA</th>
                    <th className="px-5 py-3 text-right font-medium">Hours</th>
                    <th className="px-5 py-3 text-right font-medium">Billed hours</th>
                    <th className="px-5 py-3 text-right font-medium">Pay rate</th>
                    <th className="px-5 py-3 text-right font-medium">Paid</th>
                    <th className="px-5 py-3 text-right font-medium">Invoice rate</th>
                    <th className="px-5 py-3 text-right font-medium">Invoiced</th>
                    <th className="px-5 py-3 text-right font-medium">Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-2">{clientLabel(r.clientId)}</td>
                      <td className="px-5 py-2">{personLabel(r)}</td>
                      <td className="px-5 py-2 text-right">{formatHours(r.hours)}</td>
                      <td className="px-5 py-2 text-right text-muted-foreground">
                        {formatHours(r.billedHours)}
                      </td>
                      <td className="px-5 py-2 text-right text-muted-foreground">
                        {r.payRate === null
                          ? "—"
                          : r.payRate === "salaried"
                            ? "Salary"
                            : money(r.payRate)}
                      </td>
                      <td className="px-5 py-2 text-right">{money(r.paid)}</td>
                      <td className="px-5 py-2 text-right text-muted-foreground">
                        {r.invoiceRate === null ? "No rate" : money(r.invoiceRate)}
                      </td>
                      <td className="px-5 py-2 text-right">{money(r.invoiced)}</td>
                      <td
                        className={`px-5 py-2 text-right font-semibold ${r.profit < 0 ? "text-destructive" : ""}`}
                      >
                        {money(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                    <td className="px-5 py-2" colSpan={5}>
                      {WEEKLY_DEPARTMENT_LABELS[d.key]} total
                    </td>
                    <td className="px-5 py-2 text-right">{money(d.paid)}</td>
                    <td />
                    <td className="px-5 py-2 text-right">{money(d.invoiced)}</td>
                    <td className="px-5 py-2 text-right">{money(d.profit)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="shadow-card">
        <CardContent className="grid gap-x-8 gap-y-2 px-5 py-4 text-sm tabular-nums sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Total profit</p>
            <p className="font-semibold">{money(week.totalProfit)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">+ Recruitment &amp; set-up fees</p>
            <p className="font-semibold">{money(week.recruitmentFees)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              − IB Core Team wages ({week.ib.fullTime} FT, {week.ib.partTime} PT,{" "}
              {formatHours(week.ib.hours)})
            </p>
            <p className="font-semibold">{money(week.ib.wages)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GP after wages</p>
            <p
              className={`text-lg font-semibold ${week.gpAfterWages < 0 ? "text-destructive" : ""}`}
            >
              {money(week.gpAfterWages)}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
