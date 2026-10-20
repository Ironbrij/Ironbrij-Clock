import { useMemo, useState } from "react";
import { Cell, Label, Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/mock-data";
import { splitTime, type SplitBy, type TimeSlice } from "@/lib/time-split";
import { useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";

const SPLIT_OPTIONS: { id: SplitBy; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "client", label: "Client" },
  { id: "category", label: "Task category" },
];

// Client and category slices take the validated chart slots in order
// (styles.css --chart-1..6). splitTime folds anything past six groups into
// "Other", so the slots never run out and never repeat.
const SLOTS = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-${n})`);
const OTHER_COLOR = "var(--muted-foreground)";
const MAX_SLICES = 6;

function sliceColor(slice: TimeSlice, index: number) {
  if (slice.isOther) return OTHER_COLOR;
  return slice.color ?? SLOTS[index];
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Where this week's hours went, Clockify-style: a donut split by project
 * (each in its own colour), client or task category, with the total in
 * the middle and a legend that doubles as the table — names, hours and %
 * are always visible, so nothing depends on telling colours apart.
 * Billable vs non-billable isn't offered: two slices is a ratio, and the
 * "Billable share" stat card above already says it.
 */
export function TimeSplitCard({ entries }: { entries: WorkspaceEntry[] }) {
  const { projectById } = useWorkspace();
  const [by, setBy] = useState<SplitBy>("project");
  const slices = useMemo(
    () =>
      splitTime(entries, by, projectById, { maxSlices: MAX_SLICES }).map((s, i) => ({
        ...s,
        fill: sliceColor(s, i),
      })),
    [entries, by, projectById],
  );
  const totalSeconds = slices.reduce((sum, s) => sum + s.seconds, 0);

  return (
    <Card className="shadow-card">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Time split this week</CardTitle>
        <Select value={by} onValueChange={(v) => setBy(v as SplitBy)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Split time by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPLIT_OPTIONS.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                By {o.label.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing logged yet this week — start the timer on the Time page and this fills in.
          </p>
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <ChartContainer config={{}} className="mx-auto aspect-square h-40 w-40">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    const slice = active ? (payload?.[0]?.payload as TimeSlice | undefined) : null;
                    if (!slice) return null;
                    return (
                      <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        <p className="font-medium">{slice.label}</p>
                        <p className="tabular-nums text-muted-foreground">
                          {formatDuration(slice.seconds, { seconds: "never" })} ·{" "}
                          {percent(slice.share)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Pie
                  data={slices}
                  dataKey="seconds"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={76}
                  // A 2px card-coloured ring between slices keeps neighbours
                  // apart even when two projects share a colour.
                  stroke="var(--card)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.fill} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                      const cx = viewBox.cx ?? 0;
                      const cy = viewBox.cy ?? 0;
                      return (
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan
                            x={cx}
                            y={cy - 6}
                            className="fill-foreground text-base font-semibold"
                          >
                            {formatDuration(totalSeconds, { seconds: "never" })}
                          </tspan>
                          <tspan x={cx} y={cy + 12} className="fill-muted-foreground text-[10px]">
                            this week
                          </tspan>
                        </text>
                      );
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul
              className="grid gap-2"
              aria-label={`Hours by ${by === "category" ? "task category" : by}`}
            >
              {slices.map((s) => (
                <li
                  key={s.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.fill }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm">{s.label}</span>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDuration(s.seconds, { seconds: "never" })}
                  </span>
                  <span className="text-right text-sm tabular-nums">{percent(s.share)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
