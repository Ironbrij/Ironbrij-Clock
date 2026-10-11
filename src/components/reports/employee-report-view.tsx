// Split out of src/routes/reports.tsx. Presentation only: every figure is
// computed in Reports() and passed in, so this file holds no report logic.
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/mock-data";
import type { WorkspaceClient, WorkspaceSettings } from "@/lib/workspace/types";
import { type EmployeeSortKey, formatCurrency } from "./report-config";
import type { EmployeeReportRow } from "./report-rows";

type EmployeeReportViewProps = {
  clientFilter: string;
  clients: WorkspaceClient[];
  empAsc: boolean;
  empSortKey: EmployeeSortKey;
  employeeRows: EmployeeReportRow[];
  rangeLabel: string;
  settings: WorkspaceSettings;
  sortedEmployees: EmployeeReportRow[];
  toggleEmpSort: (key: EmployeeSortKey) => void;
};

export function EmployeeReportView({
  clientFilter,
  clients,
  empAsc,
  empSortKey,
  employeeRows,
  rangeLabel,
  settings,
  sortedEmployees,
  toggleEmpSort,
}: EmployeeReportViewProps) {
  return (
    <>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            Hours by employee · {rangeLabel}
            {clientFilter !== "all" &&
              ` · ${clientFilter === "none" ? "No client" : (clients.find((c) => c.id === clientFilter)?.name ?? "")}`}
          </CardTitle>
          {clientFilter !== "all" && (
            <p className="text-xs text-muted-foreground">
              Hours shown are just for this client. Overtime and $ amount still reflect each
              person's full billable workload across everything, not only this slice.
            </p>
          )}
        </CardHeader>
        <CardContent className="h-72 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={employeeRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="name"
                tickFormatter={(v: string) => v.split(" ")[0]}
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
                formatter={(value) => [`${(value as number).toFixed(1)} h`, "Logged"]}
              />
              <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                {employeeRows.map((r) => (
                  <Cell key={r.id} fill={r.teamColor} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {(
                  [
                    ["name", "Employee"],
                    ["team", "Team"],
                    ["hours", "Hours"],
                    ["billable", "Billable"],
                    ["overtime", "Overtime"],
                    ["amount", `Amount (${settings.currency})`],
                  ] as [EmployeeSortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    className={
                      "px-5 py-3 font-medium " +
                      (key === "hours" ||
                      key === "billable" ||
                      key === "overtime" ||
                      key === "amount"
                        ? "text-right"
                        : "text-left")
                    }
                    aria-sort={
                      empSortKey === key ? (empAsc ? "ascending" : "descending") : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleEmpSort(key)}
                      className="hover:text-foreground"
                    >
                      {label}
                      <span aria-hidden="true">
                        {empSortKey === key ? (empAsc ? " ↑" : " ↓") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEmployees.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={r.avatarUrl ?? undefined} alt={r.name} />
                        <AvatarFallback className="bg-secondary text-[10px]">
                          {r.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{r.name}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.team}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatHours(r.hours)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {formatHours(r.billableHours)}
                    {r.billablePct != null && (
                      <span className="ml-1 text-xs">({r.billablePct}%)</span>
                    )}
                  </td>
                  <td
                    className={
                      "px-5 py-3 text-right tabular-nums " +
                      (r.overtime != null && r.overtime > 0
                        ? "font-medium text-destructive"
                        : "text-muted-foreground")
                    }
                    title={r.overtime == null ? "Not tracked for part-time staff" : undefined}
                  >
                    {r.overtime != null && r.overtime > 0 ? formatHours(r.overtime) : "—"}
                  </td>
                  <td
                    className="px-5 py-3 text-right tabular-nums text-muted-foreground"
                    title={r.amount == null ? "No hourly rate set for this person" : undefined}
                  >
                    {r.amount == null ? "—" : formatCurrency(r.amount, settings.currency)}
                  </td>
                </tr>
              ))}
              {sortedEmployees.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No one in this filter yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
