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
import { Combobox } from "@/components/combobox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { billableHoursForCasualEntry } from "@/lib/casual-billing";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import { addDays, formatWeekRange, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type DetailedEntry } from "@/lib/workspace-store";
import {
  CASUAL_SERVICE_CATEGORY_LABELS,
  dotColors,
  type CasualServiceCategory,
} from "@/lib/workspace/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — IronTrack" },
      {
        name: "description",
        content:
          "Hours by project over any date range, with a sortable breakdown table and export.",
      },
      { property: "og:title", content: "Reports — IronTrack" },
      { property: "og:description", content: "Hours by project with a sortable breakdown." },
    ],
  }),
  component: Reports,
});

type ProjectSortKey = "name" | "hours" | "billable" | "team";
type EmployeeSortKey = "name" | "hours" | "billable" | "team" | "overtime" | "amount";
type RangePreset = "this_week" | "this_month" | "last_30" | "this_quarter" | "this_year" | "custom";

const DETAILED_PAGE_SIZE = 50;

const presetLabels: Record<RangePreset, string> = {
  this_week: "This week",
  this_month: "This month",
  last_30: "Last 30 days",
  this_quarter: "This quarter",
  this_year: "This year",
  custom: "Custom range",
};

const casualGroupByLabels: Record<"client" | "va" | "day" | "week", string> = {
  client: "Client",
  va: "VA",
  day: "Day",
  week: "Week",
};

// M38: only ever called for the fixed presets — "custom" is resolved
// directly in Reports() from the two date inputs instead, since there's
// no formula to compute it from.
function computeRange(preset: Exclude<RangePreset, "custom">): { from: string; to: string } {
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

// H17: every value in `currencies` (workspace/types.ts) is a real ISO 4217
// code today, but this guards against a future bad value rather than
// letting Intl throw and blank the whole column.
function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
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
  const [view, setView] = useState<"project" | "employee" | "detailed" | "casual">("project");
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const todayKey = toDateKey(new Date());
  const [customFrom, setCustomFrom] = useState(todayKey);
  const [customTo, setCustomTo] = useState(todayKey);
  const [teamFilter, setTeamFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  const [projSortKey, setProjSortKey] = useState<ProjectSortKey>("hours");
  const [projAsc, setProjAsc] = useState(false);
  const [projectMinutes, setProjectMinutes] = useState<Record<string, number> | null>(null);
  // M28: billable-only, for the Billable column — total minus this is
  // non-billable.
  const [projectBillableMinutes, setProjectBillableMinutes] = useState<Record<
    string,
    number
  > | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  const [empSortKey, setEmpSortKey] = useState<EmployeeSortKey>("hours");
  const [empAsc, setEmpAsc] = useState(false);
  const [employeeMinutes, setEmployeeMinutes] = useState<Record<string, number> | null>(null);
  const [employeeBillableMinutes, setEmployeeBillableMinutes] = useState<Record<
    string,
    number
  > | null>(null);
  const [employeeClientMinutes, setEmployeeClientMinutes] = useState<Record<string, number> | null>(
    null,
  );
  const [loadingEmployee, setLoadingEmployee] = useState(true);

  // H16: entry-level detail behind its own tab — projectFilter/employeeFilter/
  // detailedSearch only apply here, on top of the team/client filters the
  // other two tabs already share.
  const [detailedEntries, setDetailedEntries] = useState<DetailedEntry[] | null>(null);
  const [loadingDetailed, setLoadingDetailed] = useState(true);
  const [projectFilter, setProjectFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [detailedSearch, setDetailedSearch] = useState("");
  const [detailedPage, setDetailedPage] = useState(1);

  // M46: casual-service rollup — its own tab, since it's a different
  // dimension (client x category) over the same time_entries, not just
  // another filter on the existing three tabs. The rows themselves are
  // derived from `detailedEntries` below, not fetched separately.
  const [casualLastService, setCasualLastService] = useState<Map<string, string | null>>(new Map());
  const [loadingCasual, setLoadingCasual] = useState(true);
  const [casualGroupBy, setCasualGroupBy] = useState<"client" | "va" | "day" | "week">("client");
  const [casualCategoryFilter, setCasualCategoryFilter] = useState<"all" | CasualServiceCategory>(
    "all",
  );
  // Dashboard's own "vs last week" indicator — only meaningful for the
  // this_week preset (see pctChange's own comment), not a generic
  // period-over-period comparison invented for every preset.
  const [lastWeekDetailedEntries, setLastWeekDetailedEntries] = useState<DetailedEntry[] | null>(
    null,
  );

  const {
    projects,
    teams,
    clients,
    members,
    settings,
    canManage,
    employmentByUser,
    projectHoursForRange,
    projectBillableHoursForRange,
    employeeHoursForRange,
    employeeBillableHoursForRange,
    employeeClientHoursForRange,
    detailedEntriesForRange,
    casualClientLastServiceForAll,
  } = useWorkspace();

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      // Guard against an empty or inverted range (e.g. "to" cleared, or
      // "from" typed after "to") rather than feeding one downstream — an
      // inverted range would silently return zero rows everywhere.
      return customFrom && customTo && customFrom <= customTo
        ? { from: customFrom, to: customTo }
        : { from: todayKey, to: todayKey };
    }
    return computeRange(preset);
  }, [preset, customFrom, customTo, todayKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProject(true);
    Promise.all([projectHoursForRange(from, to), projectBillableHoursForRange(from, to)])
      .then(([totals, billable]) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        totals.forEach((r) => {
          map[r.projectId] = r.minutes;
        });
        setProjectMinutes(map);
        const billableMap: Record<string, number> = {};
        billable.forEach((r) => {
          billableMap[r.projectId] = r.minutes;
        });
        setProjectBillableMinutes(billableMap);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, projectHoursForRange, projectBillableHoursForRange]);

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
    Promise.all([
      employeeHoursForRange(from, to),
      employeeBillableHoursForRange(from, to),
      employeeClientHoursForRange(from, to),
    ])
      .then(([totals, billable, byClient]) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        totals.forEach((r) => {
          map[r.userId] = r.minutes;
        });
        setEmployeeMinutes(map);
        const billableMap: Record<string, number> = {};
        billable.forEach((r) => {
          billableMap[r.userId] = r.minutes;
        });
        setEmployeeBillableMinutes(billableMap);
        const clientMap: Record<string, number> = {};
        byClient.forEach((r) => {
          clientMap[`${r.userId}::${r.clientId ?? "none"}`] = r.minutes;
        });
        setEmployeeClientMinutes(clientMap);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingEmployee(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    from,
    to,
    canManage,
    employeeHoursForRange,
    employeeBillableHoursForRange,
    employeeClientHoursForRange,
  ]);

  // H16: raw entries for the Detailed tab — only fetched for managers/
  // admins, same reasoning as the employee totals above (a plain Member's
  // own rows aren't a cross-team billing report on their own, and the tab
  // itself is hidden for them).
  useEffect(() => {
    if (!canManage) {
      setLoadingDetailed(false);
      return;
    }
    let cancelled = false;
    setLoadingDetailed(true);
    detailedEntriesForRange(from, to)
      .then((rows) => {
        if (!cancelled) setDetailedEntries(rows);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingDetailed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, canManage, detailedEntriesForRange]);

  // M46: client-health data (all-time, company-wide) — the casual-service
  // rollup itself is derived below from `detailedEntries` (already fetched
  // for the Detailed tab above), not a separate per-range fetch, so the
  // billing-increment rounding rule can be applied per task line before
  // summing rather than after (see casual-billing.ts).
  useEffect(() => {
    if (!canManage) {
      setLoadingCasual(false);
      return;
    }
    let cancelled = false;
    setLoadingCasual(true);
    casualClientLastServiceForAll()
      .then((lastService) => {
        if (!cancelled) setCasualLastService(lastService);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingCasual(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, casualClientLastServiceForAll]);

  // M46: "vs last week" for the casual-service KPI row — only fetched when
  // that comparison is actually shown (this_week preset), not on every
  // range change. Full prior calendar week (Mon-Sun), same as index.tsx's
  // own "Last week" card pattern, not just "7 days before `from`."
  useEffect(() => {
    if (!canManage || preset !== "this_week") {
      setLastWeekDetailedEntries(null);
      return;
    }
    let cancelled = false;
    const lastWeekFrom = toDateKey(addDays(fromDateKey(from), -7));
    const lastWeekTo = toDateKey(addDays(fromDateKey(from), -1));
    detailedEntriesForRange(lastWeekFrom, lastWeekTo)
      .then((rows) => {
        if (!cancelled) setLastWeekDetailedEntries(rows);
      })
      .catch(() => {
        // Non-critical — the delta indicators just won't show if this fails.
        if (!cancelled) setLastWeekDetailedEntries(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, preset, from, detailedEntriesForRange]);

  // Any filter/range change invalidates whatever page the table was
  // scrolled to — resetting avoids landing on a now out-of-range page.
  useEffect(() => {
    setDetailedPage(1);
  }, [from, to, teamFilter, clientFilter, projectFilter, employeeFilter, detailedSearch]);

  const projectRows = projects
    // A project with no team set isn't unassigned — the "All teams" choice
    // in the New/Edit Project dialog stores it that way on purpose, so it
    // should surface under every specific team filter, not just "All".
    .filter((p) => teamFilter === "all" || p.teamId === teamFilter || !p.teamId)
    .filter((p) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return p.clientId === null;
      return p.clientId === clientFilter;
    })
    .map((p) => {
      const hours = (projectMinutes?.[p.id] ?? 0) / 60;
      const billableHours = (projectBillableMinutes?.[p.id] ?? 0) / 60;
      return {
        ...p,
        hours,
        // M28: summed from time_entries.is_billable, not projects.is_billable
        // — a project's own flag is only the *default* now that M26 lets a
        // single entry override it.
        billableHours,
        billablePct: hours > 0 ? Math.round((billableHours / hours) * 100) : null,
        team: teams.find((t) => t.id === p.teamId)?.name ?? "All teams",
      };
    });

  const sortedProjects = [...projectRows].sort((a, b) => {
    const dir = projAsc ? 1 : -1;
    if (projSortKey === "hours") return (a.hours - b.hours) * dir;
    if (projSortKey === "billable") return (a.billableHours - b.billableHours) * dir;
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
      const totalHours = (employeeMinutes?.[m.id] ?? 0) / 60;
      const hours =
        clientFilter === "all"
          ? totalHours
          : (employeeClientMinutes?.[`${m.id}::${clientFilter}`] ?? 0) / 60;
      const memberTeams = m.teamIds
        .map((id) => teams.find((t) => t.id === id))
        .filter((t): t is (typeof teams)[number] => !!t);
      // There's no stored expected-hours-per-week for part-time staff (only
      // a free-text schedule note), so comparing them against the
      // workspace's full-time weeklyHours target would just be wrong — null
      // means "not applicable," not "no overtime."
      const isPartTime = employmentByUser.get(m.id)?.employmentType === "part_time";
      // H17: billable hours * hourly_rate, in the workspace's own currency.
      // Same reasoning as overtime below — this always reflects the
      // person's full billable workload, not narrowed by the client filter
      // (a per-client-and-billable breakdown doesn't exist as its own RPC,
      // and "$ for one client" would need that, not just filtered hours).
      const rate = employmentByUser.get(m.id)?.hourlyRate ?? null;
      const billableHours = (employeeBillableMinutes?.[m.id] ?? 0) / 60;
      const amount = rate != null ? billableHours * rate : null;
      // M28: same "full workload, not client-filtered" reasoning as
      // billableHours/amount above.
      const billablePct = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : null;
      return {
        ...m,
        hours,
        billableHours,
        billablePct,
        amount,
        // Overtime always reflects real total workload, even when a client
        // filter narrows which hours are shown — "overtime for one client"
        // isn't a meaningful figure on its own.
        overtime: isPartTime ? null : Math.max(0, totalHours - expectedHours),
        team: memberTeams.length ? memberTeams.map((t) => t.name).join(", ") : "",
        teamColor: memberTeams[0]?.color ?? "var(--muted-foreground)",
      };
    });

  const sortedEmployees = [...employeeRows].sort((a, b) => {
    const dir = empAsc ? 1 : -1;
    if (empSortKey === "hours") return (a.hours - b.hours) * dir;
    if (empSortKey === "billable") return (a.billableHours - b.billableHours) * dir;
    if (empSortKey === "amount") return ((a.amount ?? -1) - (b.amount ?? -1)) * dir;
    if (empSortKey === "overtime") return ((a.overtime ?? -1) - (b.overtime ?? -1)) * dir;
    if (empSortKey === "team") return a.team.localeCompare(b.team) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  // H16: entry-level rows for the Detailed tab, resolved against the
  // already-loaded projects/members arrays rather than a DB join — same
  // pattern ApprovalEntries/projectById already use for the Approvals
  // expand-row.
  const detailedRows = (detailedEntries ?? []).map((e) => {
    const project = projects.find((p) => p.id === e.projectId);
    const member = members.find((m) => m.id === e.userId);
    return {
      ...e,
      hours: e.minutes / 60,
      projectName: project?.name ?? "No project",
      projectColor: project?.color ?? "var(--muted-foreground)",
      teamId: project?.teamId ?? "",
      clientId: project?.clientId ?? null,
      employeeName: member?.name ?? "Former member",
      employeeInitials: member?.initials ?? "—",
      employeeAvatarUrl: member?.avatarUrl ?? null,
    };
  });

  const filteredDetailed = detailedRows
    .filter((r) => teamFilter === "all" || r.teamId === teamFilter || !r.teamId)
    .filter((r) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return r.clientId === null;
      return r.clientId === clientFilter;
    })
    .filter((r) => projectFilter === "all" || r.projectId === projectFilter)
    .filter((r) => employeeFilter === "all" || r.userId === employeeFilter)
    .filter((r) => {
      const q = detailedSearch.trim().toLowerCase();
      if (!q) return true;
      return r.description.toLowerCase().includes(q) || r.task.toLowerCase().includes(q);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  // M46: casual-service rollup — same team/client filters as the other
  // tabs, plus a category filter of its own (see casualGroupBy below).
  // Rounding is applied per entry (via billableHoursForCasualEntry) before
  // summing, since rounding a pre-summed total would give a different,
  // wrong number — see casual-billing.ts's own comment. Factored as a
  // plain function (not derived from `detailedRows`, which is specific to
  // the Detailed tab's own `detailedEntries` state) so the exact same
  // join+filter logic applies to the "vs last week" comparison's
  // separately-fetched entries too.
  function joinAndFilterCasualEntries(entries: DetailedEntry[]) {
    return entries
      .map((e) => {
        const project = projects.find((p) => p.id === e.projectId);
        return { ...e, teamId: project?.teamId ?? "", clientId: project?.clientId ?? null };
      })
      .filter((r) => r.serviceCategory !== null)
      .filter((r) => teamFilter === "all" || r.teamId === teamFilter || !r.teamId)
      .filter((r) => {
        if (clientFilter === "all") return true;
        if (clientFilter === "none") return r.clientId === null;
        return r.clientId === clientFilter;
      })
      .filter((r) => casualCategoryFilter === "all" || r.serviceCategory === casualCategoryFilter);
  }

  const casualEntries = joinAndFilterCasualEntries(detailedEntries ?? []);
  const lastWeekCasualEntries = joinAndFilterCasualEntries(lastWeekDetailedEntries ?? []);

  const casualBillableTotal = (entries: typeof casualEntries) =>
    entries.reduce(
      (s, e) =>
        s + billableHoursForCasualEntry(e, e.serviceCategory, settings.casualBillingIncrementHours),
      0,
    );

  // M46: KPI row — Active Clients/VAs always reflect the real distinct
  // count regardless of which Group by dimension is selected below (a
  // "VA" grouping still means "3 clients had casual work this period").
  const casualActiveClients = new Set(casualEntries.map((e) => e.clientId ?? "none")).size;
  const casualActiveVAs = new Set(casualEntries.map((e) => e.userId)).size;
  const casualTotalBillableHours = casualBillableTotal(casualEntries);
  const casualHasLastWeekData = preset === "this_week" && lastWeekDetailedEntries !== null;
  const lastWeekCasualActiveClients = new Set(
    lastWeekCasualEntries.map((e) => e.clientId ?? "none"),
  ).size;
  const lastWeekCasualActiveVAs = new Set(lastWeekCasualEntries.map((e) => e.userId)).size;
  const lastWeekCasualTotalBillableHours = casualBillableTotal(lastWeekCasualEntries);

  // M46: one bar chart — billable hours per category, the single most
  // useful "shape of the casual-service business" visual (not all ~10
  // pivot charts the original workbook had — see the plan's own scope
  // note on this).
  const casualCategoryChartData = (
    Object.keys(CASUAL_SERVICE_CATEGORY_LABELS) as CasualServiceCategory[]
  ).map((category, i) => ({
    category,
    label: CASUAL_SERVICE_CATEGORY_LABELS[category],
    hours: casualBillableTotal(casualEntries.filter((e) => e.serviceCategory === category)),
    color: dotColors[i % dotColors.length],
  }));

  // M46: "Group by" — Client (default), VA, Day, or Week. All four reuse
  // this exact same aggregation, only the grouping key changes; category
  // stays a secondary breakdown dimension within each group (matches the
  // original Client behavior, extended the same way to VA/Day/Week).
  const casualRows = (() => {
    const groups = new Map<
      string,
      {
        groupKey: string;
        serviceCategory: CasualServiceCategory;
        entryCount: number;
        rawHours: number;
        billableHours: number;
        paidCount: number;
      }
    >();
    for (const e of casualEntries) {
      const category = e.serviceCategory!;
      const groupKey =
        casualGroupBy === "va"
          ? e.userId
          : casualGroupBy === "day"
            ? e.date
            : casualGroupBy === "week"
              ? toDateKey(startOfWeek(fromDateKey(e.date)))
              : (e.clientId ?? "none");
      const key = `${groupKey}::${category}`;
      const existing = groups.get(key) ?? {
        groupKey,
        serviceCategory: category,
        entryCount: 0,
        rawHours: 0,
        billableHours: 0,
        paidCount: 0,
      };
      existing.entryCount += 1;
      existing.rawHours += e.minutes / 60;
      existing.billableHours += billableHoursForCasualEntry(
        e,
        category,
        settings.casualBillingIncrementHours,
      );
      if (e.vaPaidAt) existing.paidCount += 1;
      groups.set(key, existing);
    }
    return Array.from(groups.values())
      .map((g) => {
        const groupLabel =
          casualGroupBy === "va"
            ? (members.find((m) => m.id === g.groupKey)?.name ?? "Former member")
            : casualGroupBy === "day"
              ? fromDateKey(g.groupKey).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : casualGroupBy === "week"
                ? formatWeekRange(fromDateKey(g.groupKey))
                : g.groupKey === "none"
                  ? "No client"
                  : (clients.find((c) => c.id === g.groupKey)?.name ?? "Unknown client");
        return {
          ...g,
          groupLabel,
          // Only a meaningful signal for Client grouping — a VA/day/week
          // row isn't "a client," so there's no health status to show.
          lastServiceDate:
            casualGroupBy === "client" && g.groupKey !== "none"
              ? (casualLastService.get(g.groupKey) ?? null)
              : null,
        };
      })
      .sort(
        (a, b) =>
          a.groupLabel.localeCompare(b.groupLabel) ||
          a.serviceCategory.localeCompare(b.serviceCategory),
      );
  })();

  const totalDetailedPages = Math.max(1, Math.ceil(filteredDetailed.length / DETAILED_PAGE_SIZE));
  const currentDetailedPage = Math.min(detailedPage, totalDetailedPages);
  const pagedDetailed = filteredDetailed.slice(
    (currentDetailedPage - 1) * DETAILED_PAGE_SIZE,
    currentDetailedPage * DETAILED_PAGE_SIZE,
  );

  const rangeLabel = preset === "custom" ? `${from} to ${to}` : presetLabels[preset];
  const loading =
    view === "project"
      ? loadingProject
      : view === "employee"
        ? loadingEmployee
        : view === "casual"
          ? loadingDetailed || loadingCasual
          : loadingDetailed;
  const total =
    view === "project"
      ? projectRows.reduce((s, r) => s + r.hours, 0)
      : view === "employee"
        ? employeeRows.reduce((s, r) => s + r.hours, 0)
        : view === "casual"
          ? casualTotalBillableHours
          : filteredDetailed.reduce((s, r) => s + r.hours, 0);
  // H17: only meaningful on the employee view — a project or a raw entry
  // list has no single per-row rate to sum against.
  const totalAmount =
    view === "employee" ? employeeRows.reduce((s, r) => s + (r.amount ?? 0), 0) : null;

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
    const clientLabel =
      clientFilter === "all"
        ? "all-clients"
        : clientFilter === "none"
          ? "no-client"
          : (clients.find((c) => c.id === clientFilter)?.name.replace(/\s+/g, "-") ?? "client");
    if (view === "project") {
      downloadCsv(`ironbrij-hours-by-project_${clientLabel}_${from}_to_${to}.csv`, [
        ["Project", "Team", "Hours", "Billable Hours", "Date range"],
        ...sortedProjects.map((r) => [
          r.name,
          r.team,
          r.hours.toFixed(2),
          r.billableHours.toFixed(2),
          `${from} to ${to}`,
        ]),
      ]);
    } else if (view === "employee") {
      downloadCsv(`ironbrij-hours-by-employee_${clientLabel}_${from}_to_${to}.csv`, [
        [
          "Employee",
          "Team",
          "Hours",
          "Billable Hours",
          "Overtime",
          `Amount (${settings.currency})`,
          "Date range",
        ],
        ...sortedEmployees.map((r) => [
          r.name,
          r.team,
          r.hours.toFixed(2),
          r.billableHours.toFixed(2),
          r.overtime == null ? "N/A" : r.overtime.toFixed(2),
          r.amount == null ? "No rate set" : r.amount.toFixed(2),
          `${from} to ${to}`,
        ]),
      ]);
    } else if (view === "detailed") {
      // The full filtered set, not just the current page — pagination is a
      // display convenience, not a limit on what the export should contain.
      downloadCsv(`ironbrij-detailed-entries_${clientLabel}_${from}_to_${to}.csv`, [
        ["Date", "Employee", "Project", "Task", "Description", "Hours", "Billable"],
        ...filteredDetailed.map((r) => [
          r.date,
          r.employeeName,
          r.projectName,
          r.task || "",
          r.description || "",
          r.hours.toFixed(2),
          r.billable ? "Yes" : "No",
        ]),
      ]);
    } else {
      downloadCsv(
        `ironbrij-casual-service-by-${casualGroupBy}_${clientLabel}_${from}_to_${to}.csv`,
        [
          [
            casualGroupByLabels[casualGroupBy],
            "Category",
            "Entries",
            "Raw Hours",
            "Billable Hours (rounded)",
            "Paid",
            "Unpaid",
            "Date range",
          ],
          ...casualRows.map((r) => [
            r.groupLabel,
            CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory],
            r.entryCount,
            r.rawHours.toFixed(2),
            r.billableHours.toFixed(2),
            r.paidCount,
            r.entryCount - r.paidCount,
            `${from} to ${to}`,
          ]),
        ],
      );
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
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From date"
              className="w-36"
              max={customTo || undefined}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="w-36"
              min={customFrom || undefined}
              max={todayKey}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
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
        <Combobox
          options={[
            { value: "all", label: "All clients" },
            { value: "none", label: "No client" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]}
          value={clientFilter}
          onChange={setClientFilter}
          searchPlaceholder="Search clients…"
          triggerClassName="w-48"
        />
        {canManage && (
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as "project" | "employee" | "detailed" | "casual")}
          >
            <TabsList>
              <TabsTrigger value="project">By project</TabsTrigger>
              <TabsTrigger value="employee">By employee</TabsTrigger>
              <TabsTrigger value="detailed">Detailed</TabsTrigger>
              <TabsTrigger value="casual">Casual Service</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `Total ${formatHours(total)}` +
              (totalAmount != null
                ? ` · ${formatCurrency(totalAmount, settings.currency)} billable`
                : "")}
        </span>
      </div>

      {/* H16: only meaningful once individual rows are on screen — kept as
          its own row rather than crowding the range/team/client filters
          every tab shares. */}
      {view === "detailed" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search description or task…"
            value={detailedSearch}
            onChange={(e) => setDetailedSearch(e.target.value)}
            className="w-64"
          />
          <Combobox
            options={[
              { value: "all", label: "All projects" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={projectFilter}
            onChange={setProjectFilter}
            searchPlaceholder="Search projects…"
            triggerClassName="w-48"
          />
          <Combobox
            options={[
              { value: "all", label: "All employees" },
              ...members.filter((m) => !m.pending).map((m) => ({ value: m.id, label: m.name })),
            ]}
            value={employeeFilter}
            onChange={setEmployeeFilter}
            searchPlaceholder="Search employees…"
            triggerClassName="w-48"
          />
        </div>
      )}

      {/* M46: Group by + category filter only apply to the Casual Service
          view, same reasoning the Detailed-only row above already
          establishes for keeping tab-specific filters off the shared row. */}
      {view === "casual" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Select
            value={casualGroupBy}
            onValueChange={(v) => setCasualGroupBy(v as "client" | "va" | "day" | "week")}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Group by client</SelectItem>
              <SelectItem value="va">Group by VA</SelectItem>
              <SelectItem value="day">Group by day</SelectItem>
              <SelectItem value="week">Group by week</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={casualCategoryFilter}
            onValueChange={(v) => setCasualCategoryFilter(v as "all" | CasualServiceCategory)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(Object.keys(CASUAL_SERVICE_CATEGORY_LABELS) as CasualServiceCategory[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {CASUAL_SERVICE_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {view === "project" ? (
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
                        className={
                          "px-5 py-3 font-medium " +
                          (key === "hours" || key === "billable" ? "text-right" : "text-left")
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
      ) : view === "employee" ? (
        <>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">
                Hours by employee · {rangeLabel}
                {clientFilter !== "all" &&
                  ` · ${clientFilter === "none" ? "No client" : (clients.find((c) => c.id === clientFilter)?.name ?? "")}`}
              </CardTitle>
              {clientFilter !== "all" && (
                <p className="text-xs text-muted-foreground">
                  Hours shown are just for this client. Overtime and $ amount still reflect each
                  person's full billable workload across everything, not only this slice.
                </p>
              )}
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
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    {(
                      [
                        ["name", "Employee"],
                        ["team", "Team"],
                        ["hours", "Hours"],
                        ["billable", "Billable"],
                        ["overtime", "Overtime"],
                        ["amount", `Amount (${settings.currency})`],
                      ] as [EmployeeSortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className={
                          "px-5 py-3 font-medium " +
                          (key === "hours" ||
                          key === "billable" ||
                          key === "overtime" ||
                          key === "amount"
                            ? "text-right"
                            : "text-left")
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
                            <AvatarImage src={r.avatarUrl ?? undefined} alt={r.name} />
                            <AvatarFallback className="bg-secondary text-[10px]">
                              {r.initials}
                            </AvatarFallback>
                          </Avatar>
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
                      <td
                        className={
                          "px-5 py-3 text-right tabular-nums " +
                          (r.overtime != null && r.overtime > 0
                            ? "font-medium text-destructive"
                            : "text-muted-foreground")
                        }
                        title={r.overtime == null ? "Not tracked for part-time staff" : undefined}
                      >
                        {r.overtime != null && r.overtime > 0 ? formatHours(r.overtime) : "—"}
                      </td>
                      <td
                        className="px-5 py-3 text-right tabular-nums text-muted-foreground"
                        title={r.amount == null ? "No hourly rate set for this person" : undefined}
                      >
                        {r.amount == null ? "—" : formatCurrency(r.amount, settings.currency)}
                      </td>
                    </tr>
                  ))}
                  {sortedEmployees.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
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
      ) : view === "detailed" ? (
        <>
          <Card className="shadow-card">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-left font-medium">Employee</th>
                    <th className="px-5 py-3 text-left font-medium">Project</th>
                    <th className="px-5 py-3 text-left font-medium">Task</th>
                    <th className="px-5 py-3 text-left font-medium">Description</th>
                    <th className="px-5 py-3 text-right font-medium">Hours</th>
                    <th className="px-5 py-3 text-center font-medium">Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDetailed.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {fromDateKey(r.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage
                              src={r.employeeAvatarUrl ?? undefined}
                              alt={r.employeeName}
                            />
                            <AvatarFallback className="bg-secondary text-[10px]">
                              {r.employeeInitials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{r.employeeName}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          <ProjectDot color={r.projectColor} />
                          {r.projectName}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{r.task || "—"}</td>
                      <td
                        className="max-w-[280px] truncate px-5 py-3 text-muted-foreground"
                        title={r.description || undefined}
                      >
                        {r.description || "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {formatMinutes(r.minutes)}
                      </td>
                      <td className="px-5 py-3 text-center text-xs text-muted-foreground">
                        {r.billable ? "Billable" : "Non-billable"}
                      </td>
                    </tr>
                  ))}
                  {pagedDetailed.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-8 text-center text-sm text-muted-foreground"
                      >
                        No entries in this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {filteredDetailed.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {filteredDetailed.length} {filteredDetailed.length === 1 ? "entry" : "entries"}
                {totalDetailedPages > 1 &&
                  ` · page ${currentDetailedPage} of ${totalDetailedPages}`}
              </p>
              {totalDetailedPages > 1 && (
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        className={
                          currentDetailedPage <= 1
                            ? "pointer-events-none opacity-50"
                            : "cursor-pointer"
                        }
                        onClick={() =>
                          currentDetailedPage > 1 && setDetailedPage(currentDetailedPage - 1)
                        }
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        className={
                          currentDetailedPage >= totalDetailedPages
                            ? "pointer-events-none opacity-50"
                            : "cursor-pointer"
                        }
                        onClick={() =>
                          currentDetailedPage < totalDetailedPages &&
                          setDetailedPage(currentDetailedPage + 1)
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* M46: KPI row — the workbook's Dashboard KPI cards. Delta vs
              last week only renders for the this_week preset (see
              casualHasLastWeekData's own comment) — every other range has
              no well-defined "previous period" to compare against here. */}
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <CasualKpiCard
              label="Active clients"
              value={String(casualActiveClients)}
              delta={
                casualHasLastWeekData
                  ? pctChange(casualActiveClients, lastWeekCasualActiveClients)
                  : null
              }
            />
            <CasualKpiCard
              label="Active VAs"
              value={String(casualActiveVAs)}
              delta={
                casualHasLastWeekData ? pctChange(casualActiveVAs, lastWeekCasualActiveVAs) : null
              }
            />
            <CasualKpiCard
              label="Billable hours"
              value={formatHours(casualTotalBillableHours)}
              delta={
                casualHasLastWeekData
                  ? pctChange(casualTotalBillableHours, lastWeekCasualTotalBillableHours)
                  : null
              }
            />
          </div>

          <Card className="mb-6 shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Billable hours by category · {rangeLabel}</CardTitle>
            </CardHeader>
            <CardContent className="h-64 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={casualCategoryChartData}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
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
                    formatter={(value) => [`${(value as number).toFixed(1)} h`, "Billable"]}
                  />
                  <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                    {casualCategoryChartData.map((d) => (
                      <Cell key={d.category} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Casual Service · {rangeLabel}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ad-hoc work billed outside the standard subscription retainer. "Billable Hours" is
                rounded up to the workspace's casual-billing increment for every category except
                Ironbrij (internal, never billed) — raw tracked hours are shown alongside for
                reference and are never overwritten.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">
                      {casualGroupByLabels[casualGroupBy]}
                    </th>
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    <th className="px-5 py-3 text-right font-medium">Entries</th>
                    <th className="px-5 py-3 text-right font-medium">Raw Hours</th>
                    <th className="px-5 py-3 text-right font-medium">Billable Hours</th>
                    <th className="px-5 py-3 text-right font-medium">Paid</th>
                    {casualGroupBy === "client" && (
                      <th className="px-5 py-3 text-left font-medium">Last Service</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {casualRows.map((r) => (
                    <tr
                      key={`${r.groupKey}::${r.serviceCategory}`}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3 font-medium">{r.groupLabel}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory]}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.entryCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {formatHours(r.rawHours)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium">
                        {formatHours(r.billableHours)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {r.paidCount}/{r.entryCount}
                      </td>
                      {casualGroupBy === "client" && (
                        <td className="px-5 py-3 text-muted-foreground">
                          {r.lastServiceDate
                            ? fromDateKey(r.lastServiceDate).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                  {casualRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={casualGroupBy === "client" ? 7 : 6}
                        className="px-5 py-8 text-center text-sm text-muted-foreground"
                      >
                        No casual-service entries in this filter.
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

/** M46: a percentage-change indicator, scoped to the this_week preset only — see reports.tsx's own comment on why this doesn't generalize to every date range. */
function pctChange(
  current: number,
  previous: number,
): { pct: number; direction: "up" | "down" | "flat" } {
  if (previous === 0)
    return { pct: current === 0 ? 0 : 100, direction: current > 0 ? "up" : "flat" };
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.abs(pct), direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat" };
}

function CasualKpiCard({
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
