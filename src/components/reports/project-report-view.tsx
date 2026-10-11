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
import { ProjectDot } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHours } from "@/lib/mock-data";
import type { ProjectSortKey } from "./report-config";
import type { ProjectReportRow } from "./report-rows";

type ProjectReportViewProps = {
  projAsc: boolean;
  projSortKey: ProjectSortKey;
  projectRows: ProjectReportRow[];
  rangeLabel: string;
  sortedProjects: ProjectReportRow[];
  toggleProjSort: (key: ProjectSortKey) => void;
};

export function ProjectReportView({
  projAsc,
  projSortKey,
  projectRows,
  rangeLabel,
  sortedProjects,
  toggleProjSort,
}: ProjectReportViewProps) {
  return (
    <>
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Hours by project · {rangeLabel}</CardTitle>
        </CardHeader>
        <CardContent className="h-72 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projectRows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
                {projectRows.map((r) => (
                  <Cell key={r.id} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[580px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {(
                  [
                    ["name", "Project"],
                    ["team", "Team"],
                    ["hours", "Hours"],
                    ["billable", "Billable"],
                  ] as [ProjectSortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      projSortKey === key ? (projAsc ? "ascending" : "descending") : undefined
                    }
                    className={
                      "px-5 py-3 font-medium " +
                      (key === "hours" || key === "billable" ? "text-right" : "text-left")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleProjSort(key)}
                      className="hover:text-foreground"
                    >
                      {label}
                      <span aria-hidden="true">
                        {projSortKey === key ? (projAsc ? " ↑" : " ↓") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <ProjectDot color={r.color} />
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
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
