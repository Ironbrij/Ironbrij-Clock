import { createFileRoute } from "@tanstack/react-router";
import { CalendarPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeOffBalances, timeOffHistory } from "@/lib/mock-data";

export const Route = createFileRoute("/time-off")({
  head: () => ({
    meta: [
      { title: "Time off — IronTrack" },
      {
        name: "description",
        content:
          "Your vacation, sick leave and personal day balances, plus the full history of your time-off requests.",
      },
      { property: "og:title", content: "Time off — IronTrack" },
      {
        property: "og:description",
        content: "Leave balances and request history for your Ironbrij account.",
      },
    ],
  }),
  component: TimeOffPage,
});

const statusVariant = {
  Approved: "default",
  Pending: "secondary",
  Declined: "outline",
} as const;

function TimeOffPage() {
  return (
    <AppShell
      title="Time off"
      subtitle="Your balances and requests — plan a break, we'll keep the hours straight."
      actions={
        <Button className="gap-2">
          <CalendarPlus className="h-4 w-4" /> Request time off
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {timeOffBalances.map((b) => {
          const remaining = b.total - b.used;
          return (
            <Card key={b.id} className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {b.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">{remaining}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  days left · {b.used} of {b.total} used
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(b.used / b.total) * 100}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Request history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {timeOffHistory.map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.type} · {r.range}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.days} {r.days === 1 ? "day" : "days"} · {r.note}
                  </p>
                </div>
                <Badge variant={statusVariant[r.status]}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </AppShell>
  );
}
