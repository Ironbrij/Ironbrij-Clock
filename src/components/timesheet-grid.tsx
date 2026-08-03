import { ProjectDot } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { formatHours, projects, weekGrid, weekdays } from "@/lib/mock-data";

export function TimesheetGrid() {
  const dayTotals = weekdays.map((_, i) =>
    projects.reduce((sum, p) => sum + (weekGrid[p.id]?.[i] ?? 0), 0),
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);

  return (
    <Card className="overflow-hidden shadow-card">
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Project</th>
              {weekdays.map((d) => (
                <th key={d} className="px-3 py-3 text-center font-medium">{d}</th>
              ))}
              <th className="px-5 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const row = weekGrid[p.id] ?? [];
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
                <td key={i} className="px-3 py-3 text-center tabular-nums">{t.toFixed(2)}</td>
              ))}
              <td className="px-5 py-3 text-right tabular-nums">{formatHours(weekTotal)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}