import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { toast } from "sonner";
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
import { addDays, startOfWeek, toDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Ironbrij Time" },
      {
        name: "description",
        content:
          "Hours by project over any date range, with a sortable breakdown table and export.",
      },
      { property: "og:title", content: "Reports — Ironbrij Time" },
      { property: "og:description", content: "Hours by project with a sortable breakdown." },
    ],
  }),
  component: Reports,
});

type SortKey = "name" | "hours" | "team";
type RangePreset = "this_week" | "this_month" | "last_30" | "this_quarter" | "this_year";

const presetLabels: Record<RangePreset, string> = {
  this_week: "This week",
  this_month: "This month",
  last_30: "Last 30 days",
  this_quarter: "This quarter",
  this_year: "This year",
};

function computeRange(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  const to = toDateKey(today);
  switch (preset) {
    case "this_week":
      return { from: toDateKey(startOfWeek(today)), to };
    case "last_30":
      return { from: toDateKey(addDays(today, -29)), to };
    case "this_quarter": {
      const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
      return { from: toDateKey(quarterStart), to };
    }
    case "this_year":
      return { from: toDateKey(new Date(today.getFullYear(), 0, 1)), to };
    case "this_month":
    default:
      return { from: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  }
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Reports() {
  const [sortKey, setSortKey] = useState<SortKey>("hours");
  const [asc, setAsc] = useState(false);
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [teamFilter, setTeamFilter] = useState("all");
  const [rangeMinutes, setRangeMinutes] = useState<Record<string, number> | null>(null);
  const [loadingRange, setLoadingRange] = useState(true);
  const { projects, teams, projectHoursForRange } = useWorkspace();

  const { from, to } = useMemo(() => computeRange(preset), [preset]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRange(true);
    projectHoursForRange(from, to)
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        data.forEach((r) => {
          map[r.projectId] = r.minutes;
        });
        setRangeMinutes(map);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingRange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, projectHoursForRange]);

  const teamFiltered =
    teamFilter === "all" ? projects : projects.filter((p) => p.teamId === teamFilter);
  const rows = teamFiltered.map((p) => ({
    ...p,
    hours: (rangeMinutes?.[p.id] ?? 0) / 60,
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

  const exportCsv = () => {
    downloadCsv(`ironbrij-hours_${from}_to_${to}.csv`, [
      ["Project", "Team", "Hours", "Date range"],
      ...sorted.map((r) => [r.name, r.team, r.hours.toFixed(2), `${from} to ${to}`]),
    ]);
  };

  return (
    <AppShell
      title="Reports"
      subtitle="Where the hours actually went."
      actions={
        <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={loadingRange}>
          <Download className="h-4 w-4" /> Export
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
          <SelectTrigger className="w-44 gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(presetLabels) as RangePreset[]).map((key) => (
              <SelectItem key={key} value={key}>
                {presetLabels[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {loadingRange ? "Loading…" : `Total ${formatHours(total)}`}
        </span>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Hours by project · {presetLabels[preset]}</CardTitle>
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
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                {(
                  [
                    ["name", "Project"],
                    ["team", "Team"],
                    ["hours", "Hours"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    className={
                      "px-5 py-3 font-medium " + (key === "hours" ? "text-right" : "text-left")
                    }
                  >
                    <button onClick={() => toggleSort(key)} className="hover:text-foreground">
                      {label}
                      {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
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
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
