// Split out of src/routes/reports.tsx. Presentation only: every figure is
// computed in Reports() and passed in, so this file holds no report logic.
import { Fragment, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tintedChipStyle } from "@/lib/chip-style";
import { formatHours } from "@/lib/mock-data";
import { fromDateKey } from "@/lib/time-utils";
import {
  CASUAL_SERVICE_CATEGORY_LABELS,
  type WorkspaceSettings,
  type WorkspaceTag,
} from "@/lib/workspace/types";
import { CasualKpiCard, pctChange } from "./casual-kpi-card";
import { casualGroupByChartLabels, casualGroupByLabels, type CasualSortKey } from "./report-config";
import type { CasualChartDatum, CasualGroup } from "./report-rows";

type CasualReportViewProps = {
  casualActiveClients: number;
  casualActiveVAs: number;
  casualAriaSort: (key: CasualSortKey) => "ascending" | "descending" | undefined;
  casualChartTickInterval: number;
  casualGrandTotals: {
    entryCount: number;
    rawHours: number;
    billableHours: number;
    paidCount: number;
  };
  casualGroupBy: "client" | "va" | "day" | "week";
  casualGroupChartData: CasualChartDatum[];
  casualHasLastWeekData: boolean;
  casualSortHeader: (key: CasualSortKey, label: string) => ReactNode;
  casualTotalBillableHours: number;
  lastWeekCasualActiveClients: number;
  lastWeekCasualActiveVAs: number;
  lastWeekCasualTotalBillableHours: number;
  rangeLabel: string;
  settings: WorkspaceSettings;
  sortedCasualGroups: CasualGroup[];
  tags: WorkspaceTag[];
};

export function CasualReportView({
  casualActiveClients,
  casualActiveVAs,
  casualAriaSort,
  casualChartTickInterval,
  casualGrandTotals,
  casualGroupBy,
  casualGroupChartData,
  casualHasLastWeekData,
  casualSortHeader,
  casualTotalBillableHours,
  lastWeekCasualActiveClients,
  lastWeekCasualActiveVAs,
  lastWeekCasualTotalBillableHours,
  rangeLabel,
  settings,
  sortedCasualGroups,
  tags,
}: CasualReportViewProps) {
  return (
    <>
      {/* M46: KPI row — the workbook's Dashboard KPI cards. Delta vs
              last week only renders for the this_week preset (see
              casualHasLastWeekData's own comment) — every other range has
              no well-defined "previous period" to compare against here. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <CasualKpiCard
          label="Active clients"
          value={String(casualActiveClients)}
          delta={
            casualHasLastWeekData
              ? pctChange(casualActiveClients, lastWeekCasualActiveClients)
              : null
          }
        />
        <CasualKpiCard
          label="Active VAs"
          value={String(casualActiveVAs)}
          delta={casualHasLastWeekData ? pctChange(casualActiveVAs, lastWeekCasualActiveVAs) : null}
        />
        <CasualKpiCard
          label="Billable hours"
          value={formatHours(casualTotalBillableHours)}
          delta={
            casualHasLastWeekData
              ? pctChange(casualTotalBillableHours, lastWeekCasualTotalBillableHours)
              : null
          }
        />
      </div>

      <Card className="mb-6 shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            Billable hours by {casualGroupByChartLabels[casualGroupBy]} · {rangeLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-64 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={casualGroupChartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="axisLabel"
                interval={casualChartTickInterval}
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
                labelFormatter={(_label, payload) =>
                  (payload?.[0]?.payload as { groupLabel?: string } | undefined)?.groupLabel ?? ""
                }
                formatter={(value) => [`${(value as number).toFixed(1)} h`, "Billable"]}
              />
              <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                {casualGroupChartData.map((d) => (
                  <Cell key={d.groupKey} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Casual Performance · {rangeLabel}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ad-hoc work billed outside the standard subscription retainer. "Billable Hours" adds the
            workspace's client billing uplift
            {settings.clientBillingUpliftPct > 0
              ? ` (${settings.clientBillingUpliftPct}%)`
              : ""}{" "}
            and then rounds up to the billing increment, for Paid Casual Service only — VIP Client,
            Promotional and Ironbrij all bill at exact tracked hours. Raw tracked hours are shown
            alongside for reference and are never overwritten.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium" aria-sort={casualAriaSort("group")}>
                  {casualSortHeader("group", casualGroupByLabels[casualGroupBy])}
                </th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                {tags.length > 0 && <th className="px-5 py-3 text-left font-medium">Tags</th>}
                <th
                  className="px-5 py-3 text-right font-medium"
                  aria-sort={casualAriaSort("entries")}
                >
                  {casualSortHeader("entries", "Entries")}
                </th>
                <th
                  className="px-5 py-3 text-right font-medium"
                  aria-sort={casualAriaSort("rawHours")}
                >
                  {casualSortHeader("rawHours", "Raw Hours")}
                </th>
                <th
                  className="px-5 py-3 text-right font-medium"
                  aria-sort={casualAriaSort("billableHours")}
                >
                  {casualSortHeader("billableHours", "Billable Hours")}
                </th>
                <th className="px-5 py-3 text-right font-medium" aria-sort={casualAriaSort("paid")}>
                  {casualSortHeader("paid", "Paid")}
                </th>
                {casualGroupBy === "client" && (
                  <th className="px-5 py-3 text-left font-medium">Last Service</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedCasualGroups.map((g) => {
                // A group with one category would repeat itself exactly
                // in the detail row below, so it collapses into a
                // single row naming that category instead.
                const singleCategory = g.categories.length === 1;
                return (
                  <Fragment key={g.groupKey}>
                    <tr className="border-b border-border bg-muted/30">
                      <td className="px-5 py-3 font-semibold">{g.groupLabel}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {singleCategory
                          ? CASUAL_SERVICE_CATEGORY_LABELS[g.categories[0].serviceCategory]
                          : `${g.categories.length} categories`}
                      </td>
                      {tags.length > 0 && (
                        <td className="px-5 py-3">
                          {g.tags.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {g.tags.map((t) => (
                                <span
                                  key={t.id}
                                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                                  style={tintedChipStyle(t.color)}
                                >
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="px-5 py-3 text-right tabular-nums">{g.entryCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {formatHours(g.rawHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(g.billableHours)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {g.paidCount}/{g.entryCount}
                      </td>
                      {casualGroupBy === "client" && (
                        <td className="px-5 py-3 text-muted-foreground">
                          {g.lastServiceDate
                            ? fromDateKey(g.lastServiceDate).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                      )}
                    </tr>
                    {!singleCategory &&
                      g.categories.map((r) => (
                        <tr
                          key={r.serviceCategory}
                          className="border-b border-border text-muted-foreground hover:bg-muted/40"
                        >
                          <td className="px-5 py-2" />
                          <td className="py-2 pl-9 pr-5">
                            {CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory]}
                          </td>
                          {tags.length > 0 && <td className="px-5 py-2" />}
                          <td className="px-5 py-2 text-right tabular-nums">{r.entryCount}</td>
                          <td className="px-5 py-2 text-right tabular-nums">
                            {formatHours(r.rawHours)}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">
                            {formatHours(r.billableHours)}
                          </td>
                          <td className="px-5 py-2 text-right tabular-nums">
                            {r.paidCount}/{r.entryCount}
                          </td>
                          {casualGroupBy === "client" && <td className="px-5 py-2" />}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {sortedCasualGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={(casualGroupBy === "client" ? 7 : 6) + (tags.length > 0 ? 1 : 0)}
                    className="px-5 py-8 text-center text-sm text-muted-foreground"
                  >
                    No casual-service entries in this filter.
                  </td>
                </tr>
              )}
            </tbody>
            {sortedCasualGroups.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold">
                    All {sortedCasualGroups.length} {casualGroupByChartLabels[casualGroupBy]}
                    {sortedCasualGroups.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-5 py-3" />
                  {tags.length > 0 && <td className="px-5 py-3" />}
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {casualGrandTotals.entryCount}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(casualGrandTotals.rawHours)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {formatHours(casualGrandTotals.billableHours)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {casualGrandTotals.paidCount}/{casualGrandTotals.entryCount}
                  </td>
                  {casualGroupBy === "client" && <td className="px-5 py-3" />}
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </>
  );
}
