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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours } from "@/lib/mock-data";
import { addDays, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
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

type ProjectSortKey = "name" | "hours" | "team";
type EmployeeSortKey = "name" | "hours" | "team" | "overtime";
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
  const [view, setView] = useState<"project" | "employee">("project");
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [teamFilter, setTeamFilter] = useState("all");

  const [projSortKey, setProjSortKey] = useState<ProjectSortKey>("hours");
  const [projAsc, setProjAsc] = useState(false);
  const [projectMinutes, setProjectMinutes] = useState<Record<string, number> | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  const [empSortKey, setEmpSortKey] = useState<EmployeeSortKey>("hours");
  const [empAsc, setEmpAsc] = useState(false);
  const [employeeMinutes, setEmployeeMinutes] = useState<Record<string, number> | null>(null);
  const [loadingEmployee, setLoadingEmployee] = useState(true);

  const {
    projects,
    teams,
    members,
    settings,
    canManage,
    projectHoursForRange,
    employeeHoursForRange,
  } = useWorkspace();

  const { from, to } = useMemo(() => computeRange(preset), [preset]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProject(true);
    projectHoursForRange(from, to)
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        data.forEach((r) => {
          map[r.projectId] = r.minutes;
        });
        setProjectMinutes(map);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, projectHoursForRange]);

  // Only fetched for managers/admins — a plain Member's own row is all
  // they'd get back anyway (see the migration for why), so there's
  // nothing useful to fetch for them and the tab is hidden regardless.
  useEffect(() => {
    if (!canManage) {
      setLoadingEmployee(false);
      return;
    }
    let cancelled = false;
    setLoadingEmployee(true);
    employeeHoursForRange(from, to)
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        data.forEach((r) => {
          map[r.userId] = r.minutes;
        });
        setEmployeeMinutes(map);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingEmployee(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, canManage, employeeHoursForRange]);

  const projectRows = (
    teamFilter === "all" ? projects : projects.filter((p) => p.teamId === teamFilter)
  ).map((p) => ({
    ...p,
    hours: (projectMinutes?.[p.id] ?? 0) / 60,
    team: teams.find((t) => t.id === p.teamId)?.name ?? "",
  }));

  const sortedProjects = [...projectRows].sort((a, b) => {
    const dir = projAsc ? 1 : -1;
    if (projSortKey === "hours") return (a.hours - b.hours) * dir;
    if (projSortKey === "team") return a.team.localeCompare(b.team) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  // Overtime is worked out against the weekly-hours target from Settings,
  // scaled to however many weeks the selected range covers — a plain but
  // reasonable approximation without a full attendance/shift system.
  // Simplification worth knowing: it compares the *total* for the range
  // against the *total* expected, so a light week followed by a heavy one
  // nets out rather than showing per-week overtime individually.
  const daysInRange =
    Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000) + 1;
  const expectedHours = settings.weeklyHours * (daysInRange / 7);

  const employeeRows = (canManage ? members : [])
    .filter((m) => !m.pending)
    .filter((m) => teamFilter === "all" || m.teamIds.includes(teamFilter))
    .map((m) => {
      const hours = (employeeMinutes?.[m.id] ?? 0) / 60;
      return {
        ...m,
        hours,
        overtime: Math.max(0, hours - expectedHours),
        team: teams.find((t) => t.id === m.teamId)?.name ?? "",
        teamColor: teams.find((t) => t.id === m.teamId)?.color ?? "var(--muted-foreground)",
      };
    });

  const sortedEmployees = [...employeeRows].sort((a, b) => {
    const dir = empAsc ? 1 : -1;
    if (empSortKey === "hours") return (a.hours - b.hours) * dir;
    if (empSortKey === "overtime") return (a.overtime - b.overtime) * dir;
    if (empSortKey === "team") return a.team.localeCompare(b.team) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  const loading = view === "project" ? loadingProject : loadingEmployee;
  const total =
    view === "project"
      ? projectRows.reduce((s, r) => s + r.hours, 0)
      : employeeRows.reduce((s, r) => s + r.hours, 0);

  const toggleProjSort = (key: ProjectSortKey) => {
    if (key === projSortKey) setProjAsc((v) => !v);
    else {
      setProjSortKey(key);
      setProjAsc(false);
    }
  };
  const toggleEmpSort = (key: EmployeeSortKey) => {
    if (key === empSortKey) setEmpAsc((v) => !v);
    else {
      setEmpSortKey(key);
      setEmpAsc(false);
    }
  };

  const exportCsv = () => {
    if (view === "project") {
      downloadCsv(`ironbrij-hours-by-project_${from}_to_${to}.csv`, [
        ["Project", "Team", "Hours", "Date range"],
        ...sortedProjects.map((r) => [r.name, r.team, r.hours.toFixed(2), `${from} to ${to}`]),
      ]);
    } else {
      downloadCsv(`ironbrij-hours-by-employee_${from}_to_${to}.csv`, [
        ["Employee", "Team", "Hours", "Overtime", "Date range"],
        ...sortedEmployees.map((r) => [
          r.name,
          r.team,
          r.hours.toFixed(2),
          r.overtime.toFixed(2),
          `${from} to ${to}`,
        ]),
      ]);
    }
  };

  return (
    <AppShell
      title="Reports"
      subtitle="Where the hours actually went."
      actions={
        <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={loading}>
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
        {canManage && (
          <Tabs value={view} onValueChange={(v) => setView(v as "project" | "employee")}>
            <TabsList>
              <TabsTrigger value="project">By project</TabsTrigger>
              <TabsTrigger value="employee">By employee</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `Total ${formatHours(total)}`}
        </span>
      </div>

      {view === "project" ? (
        <>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Hours by project · {presetLabels[preset]}</CardTitle>
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
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    {(
                      [
                        ["name", "Project"],
                        ["team", "Team"],
                        ["hours", "Hours"],
                      ] as [ProjectSortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className={
                          "px-5 py-3 font-medium " + (key === "hours" ? "text-right" : "text-left")
                        }
                      >
                        <button
                          onClick={() => toggleProjSort(key)}
                          className="hover:text-foreground"
                        >
                          {label}
                          {projSortKey === key ? (projAsc ? " ↑" : " ↓") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
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
        </>
      ) : (
        <>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">
                Hours by employee · {presetLabels[preset]}
              </CardTitle>
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
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    {(
                      [
                        ["name", "Employee"],
                        ["team", "Team"],
                        ["hours", "Hours"],
                        ["overtime", "Overtime"],
                      ] as [EmployeeSortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className={
                          "px-5 py-3 font-medium " +
                          (key === "hours" || key === "overtime" ? "text-right" : "text-left")
                        }
                      >
                        <button
                          onClick={() => toggleEmpSort(key)}
                          className="hover:text-foreground"
                        >
                          {label}
                          {empSortKey === key ? (empAsc ? " ↑" : " ↓") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarFallback className="bg-secondary text-[10px]">
                              {r.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{r.name}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{r.team}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatHours(r.hours)}</td>
                      <td
                        className={
                          "px-5 py-3 text-right tabular-nums " +
                          (r.overtime > 0
                            ? "font-medium text-destructive"
                            : "text-muted-foreground")
                        }
                      >
                        {r.overtime > 0 ? formatHours(r.overtime) : "—"}
                      </td>
                    </tr>
                  ))}
                  {sortedEmployees.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-5 py-8 text-center text-sm text-muted-foreground"
                      >
                        No one in this filter yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
