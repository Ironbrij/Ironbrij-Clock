import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarRange, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatHours } from "@/lib/mock-data";
import { useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Ironbrij Time" },
      { name: "description", content: "Hours by project over any date range, with a sortable breakdown table and export." },
      { property: "og:title", content: "Reports — Ironbrij Time" },
      { property: "og:description", content: "Hours by project with a sortable breakdown." },
    ],
  }),
  component: Reports,
});

type SortKey = "name" | "hours" | "team";

function Reports() {
  const [sortKey, setSortKey] = useState<SortKey>("hours");
  const [asc, setAsc] = useState(false);
  const { projects, teams } = useWorkspace();

  const rows = projects.map((p) => ({
    ...p,
    week: p.weekHours,
    team: teams.find((t) => t.id === p.teamId)?.name ?? "",
  }));

  const sorted = [...rows].sort((a, b) => {
    const dir = asc ? 1 : -1;
    if (sortKey === "hours") return (a.hours - b.hours) * dir;
    if (sortKey === "team") return a.team.localeCompare(b.team) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  const total = rows.reduce((s, r) => s + r.hours, 0);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  return (
    <AppShell
      title="Reports"
      subtitle="Where the hours actually went."
      actions={
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Export
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" className="gap-2">
          <CalendarRange className="h-4 w-4" /> 1 Jun – 30 Jun 2026
        </Button>
        <Select defaultValue="all">
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">Total {formatHours(total)}</span>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Hours by project</CardTitle>
        </CardHeader>
        <CardContent className="h-72 pl-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="name"
                tickFormatter={(v: string) => v.split(" ")[0]}
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke="var(--muted-foreground)"
              />
              <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
                formatter={(value) => [`${value} h`, "Logged"]}
              />
              <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={r.id} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {([["name", "Project"], ["team", "Team"], ["hours", "Hours"]] as [SortKey, string][]).map(
                  ([key, label]) => (
                    <th
                      key={key}
                      className={"px-5 py-3 font-medium " + (key === "hours" ? "text-right" : "text-left")}
                    >
                      <button onClick={() => toggleSort(key)} className="hover:text-foreground">
                        {label}
                        {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ),
                )}
                <th className="px-5 py-3 text-right font-medium">This week</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
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
                    {formatHours(r.week)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}