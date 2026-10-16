// Split out of src/routes/reports.tsx. Presentation only: every figure is
// computed in Reports() and passed in, so this file holds no report logic.
import { Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/mock-data";
import type { WorkspaceSettings } from "@/lib/workspace/types";
import { formatCurrency, type ProfitGroupBy, profitGroupByLabels } from "./report-config";
import type {
  DepartmentRow,
  FeeReportRow,
  ProfitGroup,
  RetainerReportRow,
  SalaryWeekRow,
} from "./report-rows";

type ProfitReportViewProps = {
  combinedTotals: { cost: number; revenue: number; profit: number };
  costCellLabel: (r: { costKnown: boolean; cost: number; salariedHours: number }) => string;
  departmentRows: DepartmentRow[];
  departmentTotals: { actualHours: number; billedHours: number; paid: number; invoice: number };
  profitGrandTotals: {
    actualHours: number;
    billedHours: number;
    cost: number;
    revenue: number;
    profit: number;
  };
  profitGroupBy: ProfitGroupBy;
  profitGroups: ProfitGroup[];
  profitTruncated: boolean;
  rangeLabel: string;
  retainerRows: RetainerReportRow[];
  retainerTotals: { cost: number; revenue: number; profit: number };
  retainersApply: boolean;
  feeRows: FeeReportRow[];
  feeTotal: number;
  feesApply: boolean;
  salariesApply: boolean;
  salaryTotals: { salary: number; hourlyProfit: number; net: number };
  salaryWeeks: SalaryWeekRow[];
  settings: WorkspaceSettings;
};

export function ProfitReportView({
  combinedTotals,
  costCellLabel,
  departmentRows,
  departmentTotals,
  profitGrandTotals,
  profitGroupBy,
  profitGroups,
  profitTruncated,
  rangeLabel,
  retainerRows,
  retainerTotals,
  retainersApply,
  feeRows,
  feeTotal,
  feesApply,
  salariesApply,
  salaryTotals,
  salaryWeeks,
  settings,
}: ProfitReportViewProps) {
  return (
    <>
      {/* M52: gross profit by department. Sits above the main table
              because it answers a different question — "what did each
              department earn" rather than "where did the margin come from" —
              and because it's the block that reconciles against the accounts
              workbook's own Gross Profit sheet. */}
      {!profitTruncated && departmentRows.length > 0 && (
        <Card className="mb-4 shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Gross profit by department · {rangeLabel}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Paid is each VA's pay rate × actual tracked hours; Invoice is the client's invoice
              rate × billed hours. Only Paid Casual Service hours are uplifted and rounded up, so
              every other department invoices the hours actually worked. Casual, VIP and Promotional
              work counts under its own department rather than under Full-time or Part-time, whoever
              did it.
              {!salariesApply &&
                " Salaried payroll is withheld while a client filter is active, since payroll isn't work done for one client."}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Department</th>
                  <th className="px-5 py-3 text-right font-medium">Actual Hours</th>
                  <th className="px-5 py-3 text-right font-medium">Billed Hours</th>
                  <th className="px-5 py-3 text-right font-medium">Paid</th>
                  <th className="px-5 py-3 text-right font-medium">Invoice</th>
                  <th className="px-5 py-3 text-right font-medium">Gross Profit</th>
                </tr>
              </thead>
              <tbody>
                {departmentRows.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">{r.label}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.key === "salary" ? "—" : formatHours(r.actualHours)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.key === "salary" ? "—" : formatHours(r.billedHours)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatCurrency(r.paid, settings.currency)}
                      {r.hasUnpricedWork && (
                        <span
                          className="ml-1 text-muted-foreground"
                          title="Someone in this department has no pay rate on file, so this is lower than the real figure"
                        >
                          <span aria-hidden="true">*</span>
                          <span className="sr-only">
                            (someone in this department has no pay rate on file, so this is lower
                            than the real figure)
                          </span>
                        </span>
                      )}
                      {r.salariedHours > 0 && (
                        <span
                          className="ml-1 text-muted-foreground"
                          title="Some hours here were worked by salaried staff, whose pay is in the Salaried payroll row instead"
                        >
                          <span aria-hidden="true">†</span>
                          <span className="sr-only">
                            (some hours were worked by salaried staff, whose pay is in the Salaried
                            payroll row instead)
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.key === "salary" ? "—" : formatCurrency(r.invoice, settings.currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(r.invoice - r.paid, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold">Total</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(departmentTotals.actualHours)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(departmentTotals.billedHours)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(departmentTotals.paid, settings.currency)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(departmentTotals.invoice, settings.currency)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(
                      departmentTotals.invoice - departmentTotals.paid,
                      settings.currency,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          {profitTruncated && (
            <p className="border-b border-border bg-destructive/10 px-5 py-3 text-sm text-destructive">
              This range has more entries than a single report can load, so these totals would be
              incomplete. Narrow the date range and try again.
            </p>
          )}
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">
                  {profitGroupByLabels[profitGroupBy]}
                </th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                {/* M51: "Actual" and "Billed" rather than one "Hours"
                        column — the gap between them is the uplift, and
                        which one a money column was computed from is the
                        difference between a correct figure and a 20%
                        error. */}
                <th className="px-5 py-3 text-right font-medium">Actual Hours</th>
                <th className="px-5 py-3 text-right font-medium">Billed Hours</th>
                <th className="px-5 py-3 text-right font-medium">Pay Rate</th>
                <th className="px-5 py-3 text-right font-medium">Actual Wages</th>
                <th className="px-5 py-3 text-right font-medium">Invoice Rate</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
                <th className="px-5 py-3 text-right font-medium">Gross Profit</th>
                <th className="px-5 py-3 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {profitTruncated ? null : profitGroups.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No tracked hours in this range.
                  </td>
                </tr>
              ) : (
                profitGroups.map((g) => {
                  // A group with a single client would repeat itself
                  // exactly in the detail row below, so it collapses.
                  const single = g.rows.length === 1;
                  return (
                    <Fragment key={g.key}>
                      <tr className="border-b border-border bg-muted/30">
                        <td className="px-5 py-3 font-semibold">{g.label}</td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {single ? g.rows[0].clientLabel : `${g.rows.length} clients`}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatHours(g.actualHours)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatHours(g.billedHours)}
                        </td>
                        <td className="px-5 py-3" />
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {costCellLabel(g)}
                        </td>
                        <td className="px-5 py-3" />
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {g.ratedHours > 0 ? formatCurrency(g.revenue, settings.currency) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(g.profit, settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {g.revenue > 0 ? `${((g.profit / g.revenue) * 100).toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                      {!single &&
                        g.rows.map((r) => (
                          <tr
                            key={r.key}
                            className="border-b border-border last:border-0 hover:bg-muted/40"
                          >
                            <td className="px-5 py-3" />
                            <td className="py-3 pl-9 pr-5">{r.clientLabel}</td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {formatHours(r.actualHours)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {formatHours(r.billedHours)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {/* Divided by actual hours, matching what
                                      cost is computed from — billed hours
                                      here would understate the rate by the
                                      uplift. */}
                              {r.costKnown && r.actualHours > 0
                                ? formatCurrency(r.cost / r.actualHours, settings.currency)
                                : "—"}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {costCellLabel(r)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {r.ratedHours > 0 ? (
                                formatCurrency(r.revenue / r.ratedHours, settings.currency)
                              ) : (
                                <span title="No invoice rate on file for this client">—</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {r.ratedHours > 0
                                ? formatCurrency(r.revenue, settings.currency)
                                : "—"}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {formatCurrency(r.profit, settings.currency)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {r.revenue > 0
                                ? `${((r.profit / r.revenue) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {!profitTruncated && profitGroups.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold">Total</td>
                  <td className="px-5 py-3" />
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(profitGrandTotals.actualHours)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(profitGrandTotals.billedHours)}
                  </td>
                  <td className="px-5 py-3" />
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(profitGrandTotals.cost, settings.currency)}
                  </td>
                  <td className="px-5 py-3" />
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(profitGrandTotals.revenue, settings.currency)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(profitGrandTotals.profit, settings.currency)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {profitGrandTotals.revenue > 0
                      ? `${((profitGrandTotals.profit / profitGrandTotals.revenue) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      {/* M49: placements sit in their own table because the hourly grid
            above is built from IronTrack time entries, and placed VAs log
            none. Since 2026-10-16 they're priced on each week's entered hours
            × their hourly rates (src/lib/retainer.ts). The combined total
            below is what ties the two together. */}
      {!profitTruncated && (
        <Card className="mt-6 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Placements — weekly hours × hourly rates, across this range
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {!retainersApply ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Placements aren&apos;t shown while a team filter is on — placed VAs aren&apos;t
                IronTrack members, so they don&apos;t belong to a team. Clear the team filter to
                include them.
              </p>
            ) : retainerRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No placements were live during this range.
              </p>
            ) : (
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Client</th>
                    <th className="px-5 py-3 text-left font-medium">VA</th>
                    <th className="px-5 py-3 text-right font-medium">Days</th>
                    <th className="px-5 py-3 text-right font-medium">Cost</th>
                    <th className="px-5 py-3 text-right font-medium">Revenue</th>
                    <th className="px-5 py-3 text-right font-medium">Management Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {retainerRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3 font-medium">{r.clientLabel}</td>
                      <td className="px-5 py-3">{r.vaLabel}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {r.days}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatCurrency(r.cost, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatCurrency(r.revenue, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(r.profit, settings.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50">
                    <td className="px-5 py-3 font-semibold" colSpan={3}>
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(retainerTotals.cost, settings.currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(retainerTotals.revenue, settings.currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(retainerTotals.profit, settings.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* M50: the workbook's Net Loss line. Weekly rather than one lump
            because the question is "did casual work cover payroll this
            week" — a range total averages a bad week away against a good
            one, which is exactly what the accounts team is looking for. */}
      {!profitTruncated && (
        <Card className="mt-6 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Weekly salaries — fixed payroll against gross profit
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {!salariesApply ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Salaries aren&apos;t shown while a client filter is on — payroll is a whole-company
                bill, not work done for one client. Clear the client filter to include it.
              </p>
            ) : salaryWeeks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nobody had a weekly salary during this range. Set one in Manage → Schedule to see
                payroll netted off here.
              </p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Week</th>
                    <th className="px-5 py-3 text-right font-medium">Days</th>
                    <th className="px-5 py-3 text-right font-medium">People</th>
                    <th className="px-5 py-3 text-right font-medium">Gross profit</th>
                    <th className="px-5 py-3 text-right font-medium">Salaries</th>
                    <th className="px-5 py-3 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryWeeks.map((w) => (
                    <tr
                      key={w.weekStart}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3 font-medium">{w.label}</td>
                      {/* A short leading or trailing week is shown as short
                            so it doesn't read as a payroll discrepancy. */}
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {w.days < 7 ? `${w.days}/7` : w.days}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {w.headcount}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatCurrency(w.hourlyProfit, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatCurrency(w.salary, settings.currency)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold tabular-nums ${
                          w.net < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatCurrency(w.net, settings.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/50">
                    <td className="px-5 py-3 font-semibold" colSpan={3}>
                      Range total
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(salaryTotals.hourlyProfit, settings.currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {formatCurrency(salaryTotals.salary, settings.currency)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-semibold tabular-nums ${
                        salaryTotals.net < 0 ? "text-destructive" : ""
                      }`}
                    >
                      {formatCurrency(salaryTotals.net, settings.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2026-10-16: fees with no hours behind them (Billing → Fees &
            revenue). Their own table, like placements, because none of the
            hourly columns apply to them. */}
      {!profitTruncated && feesApply && feeRows.length > 0 && (
        <Card className="mt-6 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recruitment &amp; set-up fees
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Date</th>
                  <th className="px-5 py-3 text-left font-medium">Client</th>
                  <th className="px-5 py-3 text-left font-medium">Note</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {feeRows.map((f) => (
                  <tr key={f.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-5 py-3">{f.receivedOn}</td>
                    <td className="px-5 py-3 font-medium">{f.clientLabel}</td>
                    <td className="px-5 py-3 text-muted-foreground">{f.note ?? ""}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatCurrency(f.amount, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold" colSpan={3}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatCurrency(feeTotal, settings.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}

      {!profitTruncated && retainersApply && (
        <Card className="mt-6 shadow-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-sm font-semibold">
                Total profit — hourly, placements and fees, after salaries
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(profitGrandTotals.profit, settings.currency)} hourly +{" "}
                {formatCurrency(retainerTotals.profit, settings.currency)} placements
                {feeTotal > 0 ? ` + ${formatCurrency(feeTotal, settings.currency)} fees` : ""}
                {salaryTotals.salary > 0
                  ? ` − ${formatCurrency(salaryTotals.salary, settings.currency)} salaries`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-8 tabular-nums">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Cost</p>
                <p className="font-semibold">
                  {formatCurrency(combinedTotals.cost, settings.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Revenue</p>
                <p className="font-semibold">
                  {formatCurrency(combinedTotals.revenue, settings.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Gross profit</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(combinedTotals.profit, settings.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className="font-semibold">
                  {combinedTotals.revenue > 0
                    ? `${((combinedTotals.profit / combinedTotals.revenue) * 100).toFixed(1)}%`
                    : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
