// Presentation only: History computes the breakdown (lib/work-breakdown.ts)
// and passes it in.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/mock-data";
import type { BreakdownGroup } from "@/lib/work-breakdown";

// Clients take the validated chart slots in order (styles.css --chart-1..6);
// any past the sixth share one neutral tint rather than repeat a colour.
// Ironbrij's own work is the plain muted grey. Every group's name, hours and
// share are written out, so nothing depends on telling colours apart.
const SLOTS = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-${n})`);
const INTERNAL_COLOR = "var(--muted-foreground)";
const OVERFLOW_COLOR = "color-mix(in oklch, var(--muted-foreground) 40%, transparent)";
/** Tasks listed under each group before a "Show all" button. */
const TASKS_SHOWN = 8;

const hours = (seconds: number) => formatDuration(seconds, { seconds: "never" });
const percent = (share: number) => `${Math.round(share * 100)}%`;

function groupColors(groups: BreakdownGroup[]) {
  let clientIndex = 0;
  return groups.map((g) =>
    g.internal ? INTERNAL_COLOR : (SLOTS[clientIndex++] ?? OVERFLOW_COLOR),
  );
}

export function WorkBreakdownView({
  totalSeconds,
  groups,
}: {
  totalSeconds: number;
  groups: BreakdownGroup[];
}) {
  const colors = groupColors(groups);
  const internalSeconds = groups.find((g) => g.internal)?.seconds ?? 0;
  const clientCount = groups.filter((g) => !g.internal).length;

  return (
    <Card className="mt-4 shadow-card">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          {hours(totalSeconds)} <span className="font-normal text-muted-foreground">in total</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Ironbrij {hours(internalSeconds)} · {clientCount}{" "}
          {clientCount === 1 ? "client" : "clients"} {hours(totalSeconds - internalSeconds)}
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {groups.map((g, i) => (
            <div
              key={g.key}
              style={{ width: `${g.share * 100}%`, backgroundColor: colors[i] }}
              title={`${g.label} · ${hours(g.seconds)} · ${percent(g.share)}`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border border-t border-border">
          {groups.map((g, i) => (
            <BreakdownGroupRow key={g.key} group={g} color={colors[i]} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BreakdownGroupRow({ group, color }: { group: BreakdownGroup; color: string }) {
  const [showAll, setShowAll] = useState(false);
  const tasks = showAll ? group.tasks : group.tasks.slice(0, TASKS_SHOWN);
  const hidden = group.tasks.length - tasks.length;

  return (
    <li className="px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="truncate">{group.label}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {hours(group.seconds)}{" "}
          <span className="font-normal text-muted-foreground">· {percent(group.share)}</span>
        </span>
      </div>
      <ul className="mt-2 space-y-1 pl-5">
        {tasks.map((t) => (
          <li
            key={t.label.toLowerCase()}
            className="flex justify-between gap-4 text-sm text-muted-foreground"
          >
            <span className="min-w-0 truncate">{t.label}</span>
            <span className="shrink-0 tabular-nums">{hours(t.seconds)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 ml-3 h-7 text-xs"
          onClick={() => setShowAll(true)}
        >
          Show all {group.tasks.length} tasks
        </Button>
      )}
    </li>
  );
}
