import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** M46: a percentage-change indicator, scoped to the this_week preset only — see reports.tsx's own comment on why this doesn't generalize to every date range. */
export function pctChange(
  current: number,
  previous: number,
): { pct: number; direction: "up" | "down" | "flat" } {
  if (previous === 0)
    return { pct: current === 0 ? 0 : 100, direction: current > 0 ? "up" : "flat" };
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.abs(pct), direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat" };
}

export function CasualKpiCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: { pct: number; direction: "up" | "down" | "flat" } | null;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {delta && (
          <p
            className={
              "mt-1 text-sm " +
              (delta.direction === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : delta.direction === "down"
                  ? "text-destructive"
                  : "text-muted-foreground")
            }
          >
            {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "—"}{" "}
            {delta.pct.toFixed(1)}% vs last week
          </p>
        )}
      </CardContent>
    </Card>
  );
}
