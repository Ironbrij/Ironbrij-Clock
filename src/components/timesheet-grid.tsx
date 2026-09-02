import { useState } from "react";
import { ProjectDot } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatHours } from "@/lib/mock-data";
import { weekdayNames } from "@/lib/time-utils";
import { useWeekGrid, useWorkspace } from "@/lib/workspace-store";

export function TimesheetGrid({ weekStart }: { weekStart: Date }) {
  const { projects } = useWorkspace();
  const grid = useWeekGrid(weekStart);
  // L40: every non-archived project shows as a row regardless of whether it
  // was touched this week — fine for a handful of projects, but turns into
  // mostly "—" cells to scroll past once a workspace has many. A toggle
  // (default off, so nothing changes unless asked for) rather than an
  // unconditional filter, since seeing every assigned project — even at
  // zero — is sometimes exactly the point (a checklist of what's expected).
  const [hideEmpty, setHideEmpty] = useState(false);
  const allRows = projects.filter((p) => (grid[p.id] ?? []).some((h) => h > 0) || !p.archived);
  const rows = hideEmpty ? allRows.filter((p) => (grid[p.id] ?? []).some((h) => h > 0)) : allRows;
  const dayTotals = weekdayNames.map((_, i) =>
    rows.reduce((sum, p) => sum + (grid[p.id]?.[i] ?? 0), 0),
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  return (
    <Card className="overflow-hidden shadow-card">
      {allRows.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          <Checkbox
            id="timesheet-grid-hide-empty"
            checked={hideEmpty}
            onCheckedChange={(checked) => setHideEmpty(checked === true)}
          />
          <Label
            htmlFor="timesheet-grid-hide-empty"
            className="cursor-pointer text-xs font-normal text-muted-foreground"
          >
            Hide rows with nothing logged this week
          </Label>
        </div>
      )}
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Project</th>
              {weekdayNames.map((d) => (
                <th key={d} className="px-3 py-3 text-center font-medium">
                  {d}
                </th>
              ))}
              <th className="px-5 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const row = grid[p.id] ?? [0, 0, 0, 0, 0, 0, 0];
              const total = row.reduce((a, b) => a + b, 0);
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <ProjectDot color={p.color} />
                      <span className="truncate font-medium">{p.name}</span>
                    </span>
                  </td>
                  {row.map((hours, i) => (
                    <td
                      key={i}
                      className={
                        "px-3 py-3 text-center tabular-nums " +
                        (hours ? "text-foreground" : "text-muted-foreground/40")
                      }
                    >
                      {hours ? hours.toFixed(2) : "—"}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {formatHours(total)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/50 text-sm font-medium">
              <td className="px-5 py-3">Daily total</td>
              {dayTotals.map((t, i) => (
                <td key={i} className="px-3 py-3 text-center tabular-nums">
                  {t.toFixed(2)}
                </td>
              ))}
              <td className="px-5 py-3 text-right tabular-nums">{formatHours(weekTotal)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
