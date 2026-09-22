import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { grossProfitForEntry, resolveInvoiceRate } from "@/lib/gross-profit";
import { retainerAccrualForRange } from "@/lib/retainer";
import { salaryAccrualForWeek, weeksInRange } from "@/lib/weekly-salary";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import { addDays, formatWeekRange, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import { DETAILED_ENTRIES_LIMIT, useWorkspace, type DetailedEntry } from "@/lib/workspace-store";
import {
  CASUAL_SERVICE_CATEGORY_LABELS,
  dotColors,
  NO_CLIENT,
  type CasualServiceCategory,
  type EmploymentType,
  type WorkspaceTag,
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
type CasualSortKey = "group" | "entries" | "rawHours" | "billableHours" | "paid";
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

type ProfitGroupBy = "va" | "client" | "team" | "service" | "employment";

const profitGroupByLabels: Record<ProfitGroupBy, string> = {
  va: "VA",
  client: "Client",
  team: "Team",
  service: "Service line",
  employment: "Employment type",
};

/**
 * M51: the service-line split the product owner asked for — "segregate IB,
 * VIP and Casual". Every entry already carries a service_category; this is
 * the same set with a bucket for the null case, which is by far the most
 * common one (ordinary retainer and project work) and would otherwise
 * vanish from a grouped view entirely.
 *
 * Shorter than CASUAL_SERVICE_CATEGORY_LABELS on purpose: those are written
 * to disambiguate a dropdown option, these are a table's leftmost column.
 */
const SERVICE_LINE_LABELS: Record<CasualServiceCategory | "none", string> = {
  ironbrij: "Ironbrij (internal)",
  paid_casual: "Paid Casual",
  vip_client: "VIP Client",
  promotional: "Promotional",
  none: "Retainer & other",
};

/** M51: full_time/part_time, plus the bucket for a member with no employment row yet. */
const EMPLOYMENT_LABELS: Record<EmploymentType | "unset", string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  unset: "Employment type not set",
};

/** Fixed presentation order for the P&L split — not whatever order the entries happened to arrive in. */
const EMPLOYMENT_ORDER: (EmploymentType | "unset")[] = ["full_time", "part_time", "unset"];

// Same dimension names, phrased for the chart title ("Billable hours by
// client/VA/day/week") rather than a table column header.
const casualGroupByChartLabels: Record<"client" | "va" | "day" | "week", string> = {
  client: "client",
  va: "VA",
  day: "day",
  week: "week",
};

// Client/VA bars past this point collapse into a single "Other" bar — a
// workspace with 60 clients would otherwise render 60 unreadable slivers.
// The table below still lists every group, so nothing is hidden outright.
const CASUAL_CHART_MAX_BARS = 12;
// Roughly how many x-axis ticks fit legibly across the chart's width.
const CASUAL_CHART_MAX_TICKS = 12;

// A bar gets ~60px of width; the untruncated name stays in the tooltip.
function truncateChartLabel(label: string, max = 14) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

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
  const [view, setView] = useState<"project" | "employee" | "detailed" | "casual" | "profit">(
    "project",
  );
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
  const [detailedTagFilter, setDetailedTagFilter] = useState("all");
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
  const [casualTagFilter, setCasualTagFilter] = useState("all");
  // Billable hours descending by default — "who owes the most this period"
  // is the question this tab gets opened for.
  const [casualSortKey, setCasualSortKey] = useState<CasualSortKey>("billableHours");
  const [casualAsc, setCasualAsc] = useState(false);
  // Dashboard's own "vs last week" indicator — only meaningful for the
  // this_week preset (see pctChange's own comment), not a generic
  // period-over-period comparison invented for every preset.
  const [lastWeekDetailedEntries, setLastWeekDetailedEntries] = useState<DetailedEntry[] | null>(
    null,
  );

  // M48: gross profit — cost vs revenue over the same entries, grouped by
  // whoever's margin is being questioned. Like the casual tab, the rows
  // derive from `detailedEntries` rather than a separate fetch, since the
  // per-line increment rounding has to be applied before summing.
  const [profitGroupBy, setProfitGroupBy] = useState<ProfitGroupBy>("va");

  const {
    projects,
    teams,
    clients,
    members,
    tags,
    settings,
    canManage,
    employmentByUser,
    billingRates,
    placements,
    placedVAs,
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
    const scopedTeam = teamFilter === "all" ? undefined : teamFilter;
    Promise.all([
      projectHoursForRange(from, to, scopedTeam),
      projectBillableHoursForRange(from, to, scopedTeam),
    ])
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
  }, [from, to, teamFilter, projectHoursForRange, projectBillableHoursForRange]);

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
  }, [
    from,
    to,
    teamFilter,
    clientFilter,
    projectFilter,
    employeeFilter,
    detailedTagFilter,
    detailedSearch,
  ]);

  const projectRows = projects
    // Team scoping now happens inside projectHoursForRange/
    // projectBillableHoursForRange itself (hours logged by that team's
    // members), not as a row-inclusion filter here — every project stays
    // visible, its hours just reflect whichever team is selected.
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
  // M51: the two billing settings always travel together — the uplift is
  // meaningless without knowing what rounds it, and vice versa. Passing them
  // as one object is what stops a call site applying one and not the other.
  const billingOpts = {
    incrementHours: settings.casualBillingIncrementHours,
    upliftPct: settings.clientBillingUpliftPct,
  };

  const detailedRows = (detailedEntries ?? []).map((e) => {
    const project = projects.find((p) => p.id === e.projectId);
    const member = members.find((m) => m.id === e.userId);
    return {
      ...e,
      hours: e.seconds / 3600,
      projectName: project?.name ?? "No project",
      projectColor: project?.color ?? "var(--muted-foreground)",
      // Team filter means "logged by that team's members," not "the
      // entry's project's team" — a person can belong to more than one
      // team, so this is every team they're in, not a single value.
      employeeTeamIds: member?.teamIds ?? [],
      clientId: project?.clientId ?? null,
      // M51: the entry's own tag_ids, matching what the tag filter now
      // selects on — see joinAndFilterCasualEntries. Showing the project's
      // current tags while filtering on the entry's historical ones would
      // let a row display a tag it can't be filtered by, and vice versa.
      projectTags: tags
        .filter((t) => e.tagIds.includes(t.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
      employeeName: member?.name ?? "Former member",
      employeeInitials: member?.initials ?? "—",
      employeeAvatarUrl: member?.avatarUrl ?? null,
    };
  });

  const filteredDetailed = detailedRows
    .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
    .filter((r) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return r.clientId === null;
      return r.clientId === clientFilter;
    })
    .filter((r) => projectFilter === "all" || r.projectId === projectFilter)
    .filter((r) => employeeFilter === "all" || r.userId === employeeFilter)
    .filter((r) => detailedTagFilter === "all" || r.tagIds.includes(detailedTagFilter))
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
        const member = members.find((m) => m.id === e.userId);
        return {
          ...e,
          // Same "logged by that team's members" semantics as the
          // Detailed tab's employeeTeamIds — not the entry's project's team.
          employeeTeamIds: member?.teamIds ?? [],
          clientId: project?.clientId ?? null,
          // M51: tags now come off the entry's own tag_ids, which are
          // copied from the project when the entry is logged. That is what
          // the product owner confirmed the filter should mean: how the
          // work was tagged *at the time*, so retagging a project doesn't
          // silently rewrite last quarter's report. An entry logged before
          // a tag was added to its project therefore won't match it.
          entryTagIds: e.tagIds,
        };
      })
      .filter((r) => r.serviceCategory !== null)
      .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
      .filter((r) => {
        if (clientFilter === "all") return true;
        if (clientFilter === "none") return r.clientId === null;
        return r.clientId === clientFilter;
      })
      .filter((r) => casualCategoryFilter === "all" || r.serviceCategory === casualCategoryFilter)
      .filter((r) => casualTagFilter === "all" || r.entryTagIds.includes(casualTagFilter));
  }

  const casualEntries = joinAndFilterCasualEntries(detailedEntries ?? []);
  const lastWeekCasualEntries = joinAndFilterCasualEntries(lastWeekDetailedEntries ?? []);

  const casualBillableTotal = (entries: typeof casualEntries) =>
    entries.reduce((s, e) => s + billableHoursForCasualEntry(e, e.serviceCategory, billingOpts), 0);

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
        tagIds: Set<string>;
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
        tagIds: new Set<string>(),
      };
      existing.entryCount += 1;
      existing.rawHours += e.seconds / 3600;
      existing.billableHours += billableHoursForCasualEntry(e, category, billingOpts);
      if (e.vaPaidAt) existing.paidCount += 1;
      e.entryTagIds.forEach((id) => existing.tagIds.add(id));
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
        // Tags come from each entry's project, so a group (especially VA/
        // day/week, which can span many projects) shows the union of every
        // tag any of its entries carried — same "at least one tag matched"
        // semantics as the tag filter above.
        const groupTags = tags
          .filter((t) => g.tagIds.has(t.id))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          ...g,
          groupLabel,
          tags: groupTags,
          // Only a meaningful signal for Client grouping — a VA/day/week
          // row isn't "a client," so there's no health status to show.
          lastServiceDate:
            casualGroupBy === "client" && g.groupKey !== "none"
              ? (casualLastService.get(g.groupKey) ?? null)
              : null,
        };
      })
      .sort((a, b) => a.serviceCategory.localeCompare(b.serviceCategory));
  })();

  // M46: the accounts team's actual question is "what does this client owe
  // for this period" — the per-category split is detail underneath that
  // number, not the top-level unit. So the category rows nest under their
  // group, and the group carries the subtotal that drives sorting, the
  // chart, and the export order.
  type CasualGroup = {
    groupKey: string;
    groupLabel: string;
    tags: WorkspaceTag[];
    lastServiceDate: string | null;
    categories: (typeof casualRows)[number][];
    entryCount: number;
    rawHours: number;
    billableHours: number;
    paidCount: number;
  };

  const casualGroups = (() => {
    const byGroup = new Map<string, CasualGroup>();
    const tagIdsByGroup = new Map<string, Set<string>>();
    for (const r of casualRows) {
      const existing = byGroup.get(r.groupKey) ?? {
        groupKey: r.groupKey,
        groupLabel: r.groupLabel,
        tags: [],
        lastServiceDate: r.lastServiceDate,
        categories: [],
        entryCount: 0,
        rawHours: 0,
        billableHours: 0,
        paidCount: 0,
      };
      existing.categories.push(r);
      existing.entryCount += r.entryCount;
      existing.rawHours += r.rawHours;
      existing.billableHours += r.billableHours;
      existing.paidCount += r.paidCount;
      const tagIds = tagIdsByGroup.get(r.groupKey) ?? new Set<string>();
      r.tagIds.forEach((id) => tagIds.add(id));
      tagIdsByGroup.set(r.groupKey, tagIds);
      byGroup.set(r.groupKey, existing);
    }
    return Array.from(byGroup.values()).map((g) => ({
      ...g,
      tags: tags
        .filter((t) => tagIdsByGroup.get(g.groupKey)?.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  })();

  const sortedCasualGroups = [...casualGroups].sort((a, b) => {
    const dir = casualAsc ? 1 : -1;
    if (casualSortKey === "group") {
      // Date-keyed groups have to compare on the ISO key, not the
      // formatted label — "Apr 1" sorts before "Jan 2" alphabetically.
      return (
        dir *
        (casualGroupBy === "day" || casualGroupBy === "week"
          ? a.groupKey.localeCompare(b.groupKey)
          : a.groupLabel.localeCompare(b.groupLabel))
      );
    }
    if (casualSortKey === "entries") return dir * (a.entryCount - b.entryCount);
    if (casualSortKey === "rawHours") return dir * (a.rawHours - b.rawHours);
    if (casualSortKey === "paid") return dir * (a.paidCount - b.paidCount);
    return dir * (a.billableHours - b.billableHours);
  });

  const casualGrandTotals = casualGroups.reduce(
    (acc, g) => ({
      entryCount: acc.entryCount + g.entryCount,
      rawHours: acc.rawHours + g.rawHours,
      billableHours: acc.billableHours + g.billableHours,
      paidCount: acc.paidCount + g.paidCount,
    }),
    { entryCount: 0, rawHours: 0, billableHours: 0, paidCount: 0 },
  );

  // M46: one bar chart — billable hours per whatever "Group by" dimension
  // is selected above (summed across categories within each group), so
  // switching Group by actually changes the graph, not just the table
  // beneath it. `axisLabel` is the short form the x-axis renders;
  // `groupLabel` stays the full one, which the tooltip shows on hover.
  const casualGroupChartData = (() => {
    const rows = casualGroups.map((g) => ({
      groupKey: g.groupKey,
      groupLabel: g.groupLabel,
      hours: g.billableHours,
    }));

    // Day/week read as a time series, so they stay chronological and
    // uncapped — dropping the quiet middle of a date range would misread
    // as "nothing happened there." Density is handled by thinning the
    // ticks (see the XAxis interval) rather than dropping bars.
    if (casualGroupBy === "day" || casualGroupBy === "week") {
      return rows
        .sort((a, b) => a.groupKey.localeCompare(b.groupKey))
        .map((r, i) => ({
          ...r,
          axisLabel: fromDateKey(r.groupKey).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          color: dotColors[i % dotColors.length],
        }));
    }

    // Client/VA are a ranking, not a series — biggest first, with the long
    // tail summed into one labelled "Other" bar.
    rows.sort((a, b) => b.hours - a.hours);
    const bars = rows.slice(0, CASUAL_CHART_MAX_BARS).map((r) => ({
      ...r,
      axisLabel: truncateChartLabel(r.groupLabel),
    }));
    const rest = rows.slice(CASUAL_CHART_MAX_BARS);
    if (rest.length > 0) {
      bars.push({
        groupKey: "__other__",
        groupLabel: `Other (${rest.length} ${casualGroupBy === "va" ? "VAs" : "clients"})`,
        axisLabel: "Other",
        hours: rest.reduce((s, r) => s + r.hours, 0),
      });
    }
    return bars.map((r, i) => ({ ...r, color: dotColors[i % dotColors.length] }));
  })();

  // Recharts' `interval` is "ticks to skip between rendered ticks," so 0
  // means every bar gets a label — right for a dozen clients, wrong for a
  // year of days.
  const casualChartTickInterval = Math.max(
    0,
    Math.ceil(casualGroupChartData.length / CASUAL_CHART_MAX_TICKS) - 1,
  );

  // M48: gross profit, derived from the same `detailedEntries` the
  // Detailed and Casual tabs already use. Unlike the casual rollup this
  // does NOT drop entries with a null service_category — margin covers all
  // tracked work, retainer included, not just the casual program.
  const profitEntries = (detailedEntries ?? [])
    .map((e) => {
      const project = projects.find((p) => p.id === e.projectId);
      const member = members.find((m) => m.id === e.userId);
      return {
        ...e,
        employeeTeamIds: member?.teamIds ?? [],
        clientId: project?.clientId ?? null,
      };
    })
    .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
    .filter((r) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return r.clientId === null;
      return r.clientId === clientFilter;
    });

  // Per entry, never on a pre-summed total — the casual increment rounds
  // each task line up on its own (see gross-profit.ts).
  const pricedProfitEntries = profitEntries.map((e) => {
    const employment = employmentByUser.get(e.userId);
    const payRate = employment?.hourlyRate ?? null;
    // M50: a salaried member's cost is their flat weekly figure, charged once
    // per week in the salary block below — never per entry, or it doubles.
    const salaried = employment?.weeklySalary != null;
    const invoiceRate = e.clientId
      ? resolveInvoiceRate(billingRates, e.clientId, e.userId, e.date)
      : null;
    const money = grossProfitForEntry(e, {
      payRate,
      invoiceRate,
      ...billingOpts,
      salaried,
    });
    return { ...e, ...money, payRate, invoiceRate };
  });

  type ProfitRow = {
    key: string;
    groupKey: string;
    groupLabel: string;
    clientLabel: string;
    /** M51: hours actually tracked — the basis for `cost`, and what the internal view shows. */
    actualHours: number;
    /** M51: hours invoiced — uplifted and rounded up. The basis for `revenue`. */
    billedHours: number;
    cost: number;
    revenue: number;
    profit: number;
    /** Billed hours that actually produced revenue — the denominator for a blended invoice rate. */
    ratedHours: number;
    /** Chargeable billed hours with no invoice rate on file, so the row is knowingly incomplete. */
    unpricedHours: number;
    costKnown: boolean;
    /** M50: actual hours worked by salaried staff, whose cost sits in the salary block rather than here. */
    salariedHours: number;
  };

  const profitRows: ProfitRow[] = (() => {
    const map = new Map<string, ProfitRow>();
    for (const e of pricedProfitEntries) {
      const clientLabel = e.clientId
        ? (clients.find((c) => c.id === e.clientId)?.name ?? "Unknown client")
        : NO_CLIENT;
      // A VA on two teams contributes to both — team membership is
      // many-to-many here, the same semantics the rest of the app accepts.
      // Grand totals below are computed from the entries directly, so this
      // never double-counts into them.
      // M51: service line and employment type join VA/client/team as
      // grouping dimensions. Both are single-valued per entry, so unlike
      // the team branch below neither can put one entry into two groups.
      const serviceKey = e.serviceCategory ?? "none";
      const employmentKey = employmentByUser.get(e.userId)?.employmentType ?? "unset";

      const groups: { key: string; label: string }[] =
        profitGroupBy === "va"
          ? [
              {
                key: e.userId,
                label: members.find((m) => m.id === e.userId)?.name ?? "Former member",
              },
            ]
          : profitGroupBy === "client"
            ? [{ key: e.clientId ?? "none", label: clientLabel }]
            : profitGroupBy === "service"
              ? [{ key: serviceKey, label: SERVICE_LINE_LABELS[serviceKey] }]
              : profitGroupBy === "employment"
                ? [{ key: employmentKey, label: EMPLOYMENT_LABELS[employmentKey] }]
                : e.employeeTeamIds.length > 0
                  ? e.employeeTeamIds.map((tid) => ({
                      key: tid,
                      label: teams.find((t) => t.id === tid)?.name ?? "Unknown team",
                    }))
                  : [{ key: "none", label: "No team" }];

      for (const group of groups) {
        const key = `${group.key}::${e.clientId ?? "none"}`;
        const row = map.get(key) ?? {
          key,
          groupKey: group.key,
          groupLabel: group.label,
          clientLabel,
          actualHours: 0,
          billedHours: 0,
          cost: 0,
          revenue: 0,
          profit: 0,
          ratedHours: 0,
          unpricedHours: 0,
          costKnown: false,
          salariedHours: 0,
        };
        row.actualHours += e.actualHours;
        row.billedHours += e.billedHours;
        row.cost += e.cost ?? 0;
        row.revenue += e.revenue ?? 0;
        row.profit += e.profit;
        // Only hourly work makes the cost column meaningful. Salaried work
        // costs 0 here by design, so counting it would render a real-looking
        // $0.00 where the honest answer is "charged in the salary block".
        if (e.costBasis === "hourly") row.costKnown = true;
        // M51: salaried and unpriced hours describe what the *cost* side is
        // missing, so they count actual hours — the figure that side is
        // computed from. ratedHours/unpricedHours describe the revenue side
        // and stay in billed hours, or a blended invoice rate divided by
        // them would come out uplifted by 20%.
        if (e.costBasis === "salary") row.salariedHours += e.actualHours;
        if (e.revenue !== null) row.ratedHours += e.billedHours;
        else if (e.billable && e.serviceCategory !== "ironbrij" && e.clientId) {
          row.unpricedHours += e.billedHours;
        }
        map.set(key, row);
      }
    }
    return Array.from(map.values());
  })();

  type ProfitGroup = {
    key: string;
    label: string;
    rows: ProfitRow[];
    actualHours: number;
    billedHours: number;
    cost: number;
    revenue: number;
    profit: number;
    ratedHours: number;
    unpricedHours: number;
    costKnown: boolean;
    salariedHours: number;
  };

  const profitGroups: ProfitGroup[] = (() => {
    const map = new Map<string, ProfitGroup>();
    for (const row of profitRows) {
      const group = map.get(row.groupKey) ?? {
        key: row.groupKey,
        label: row.groupLabel,
        rows: [],
        actualHours: 0,
        billedHours: 0,
        cost: 0,
        revenue: 0,
        profit: 0,
        ratedHours: 0,
        unpricedHours: 0,
        costKnown: false,
        salariedHours: 0,
      };
      group.rows.push(row);
      group.actualHours += row.actualHours;
      group.billedHours += row.billedHours;
      group.cost += row.cost;
      group.revenue += row.revenue;
      group.profit += row.profit;
      group.ratedHours += row.ratedHours;
      group.unpricedHours += row.unpricedHours;
      group.costKnown = group.costKnown || row.costKnown;
      group.salariedHours += row.salariedHours;
      map.set(row.groupKey, group);
    }
    for (const group of map.values()) {
      group.rows.sort((a, b) => b.profit - a.profit || b.actualHours - a.actualHours);
    }
    // Most profitable first — "where is the margin coming from" is the
    // question this tab gets opened for.
    return Array.from(map.values()).sort(
      (a, b) => b.profit - a.profit || b.actualHours - a.actualHours,
    );
  })();

  // Straight from the entries, so a VA counted under two teams above still
  // only contributes once here.
  const profitGrandTotals = pricedProfitEntries.reduce(
    (acc, e) => ({
      actualHours: acc.actualHours + e.actualHours,
      billedHours: acc.billedHours + e.billedHours,
      cost: acc.cost + (e.cost ?? 0),
      revenue: acc.revenue + (e.revenue ?? 0),
      profit: acc.profit + e.profit,
    }),
    { actualHours: 0, billedHours: 0, cost: 0, revenue: 0, profit: 0 },
  );

  // M49: the retainer half of profitability. Monthly placements have no
  // hours, so they can't join the hourly table above — a monthly fee
  // spread across the range is a different kind of number. They get their
  // own section, and the two profits are summed into a combined total.
  //
  // No double-counting: placed VAs aren't IronTrack users and log no time
  // entries, so retainer cost and hourly wage cost never overlap.
  // Placed VAs have no team — they aren't IronTrack members. Rather than
  // show retainers unfiltered next to team-filtered hourly rows (which
  // would make the combined total wrong for that team), the section is
  // withheld entirely while a team filter is active, and says so.
  const retainersApply = teamFilter === "all";

  const retainerRows = (retainersApply ? placements : [])
    .map((p) => ({
      ...p,
      ...retainerAccrualForRange(p, from, to),
      vaLabel: placedVAs.find((v) => v.id === p.placedVaId)?.fullName ?? "Unknown VA",
      clientLabel: clients.find((c) => c.id === p.clientId)?.name ?? "Unknown client",
    }))
    // A placement that wasn't live during the range isn't a zero row, it's
    // simply not part of this report.
    .filter((r) => r.days > 0)
    .filter((r) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return false;
      return r.clientId === clientFilter;
    })
    .sort((a, b) => b.profit - a.profit || a.clientLabel.localeCompare(b.clientLabel));

  const retainerTotals = retainerRows.reduce(
    (acc, r) => ({
      cost: acc.cost + r.cost,
      revenue: acc.revenue + r.revenue,
      profit: acc.profit + r.profit,
    }),
    { cost: 0, revenue: 0, profit: 0 },
  );

  // M50: the workbook's Net Loss line — casual gross profit against the fixed
  // weekly salary bill, week by week, because "did casual work cover payroll"
  // is a weekly question even when the report range isn't.
  //
  // Withheld under a client filter, for the same reason retainers are withheld
  // under a team filter: payroll is a whole-company bill, not work done for one
  // client, so netting it against a single client's margin would be nonsense.
  const salariesApply = clientFilter === "all";

  const salariedMembers = (salariesApply ? members : [])
    .filter((m) => teamFilter === "all" || m.teamIds.includes(teamFilter))
    .flatMap((m) => {
      const employment = employmentByUser.get(m.id);
      return employment && employment.weeklySalary !== null ? [employment] : [];
    });

  const salaryWeeks = (() => {
    if (salariedMembers.length === 0) return [];
    // Same Monday-start bucketing the Casual tab already groups by.
    const profitByWeek = new Map<string, number>();
    for (const e of pricedProfitEntries) {
      const key = toDateKey(startOfWeek(fromDateKey(e.date)));
      profitByWeek.set(key, (profitByWeek.get(key) ?? 0) + e.profit);
    }
    return (
      weeksInRange(from, to)
        .map((week) => {
          let salary = 0;
          let headcount = 0;
          for (const employment of salariedMembers) {
            const accrual = salaryAccrualForWeek(employment, week);
            if (accrual.days > 0) headcount += 1;
            salary += accrual.salary;
          }
          const hourlyProfit = profitByWeek.get(week.weekStart) ?? 0;
          return {
            ...week,
            label: formatWeekRange(fromDateKey(week.weekStart)),
            salary,
            headcount,
            hourlyProfit,
            net: hourlyProfit - salary,
          };
        })
        // A week where nobody was salaried and nothing was earned isn't a zero
        // row, it simply isn't part of this report.
        .filter((w) => w.salary > 0 || w.hourlyProfit !== 0)
    );
  })();

  const salaryTotals = salaryWeeks.reduce(
    (acc, w) => ({
      salary: acc.salary + w.salary,
      hourlyProfit: acc.hourlyProfit + w.hourlyProfit,
      net: acc.net + w.net,
    }),
    { salary: 0, hourlyProfit: 0, net: 0 },
  );

  /**
   * M51: the profit-and-loss split by employment type — "separate full time
   * and parttime / actual hours and actual wages".
   *
   * Deliberately its own block rather than just a grouping of the table
   * above, because a salaried member's cost isn't in that table at all. M50
   * charges a fixed weekly salary once per week and costs their entries at
   * zero, so grouping the hourly rows by employment type would show
   * Full-time as $0.00 wages against real hours — a figure that looks like
   * data and is actually an artefact. This block carries both columns and
   * adds them, so the total cost per employment type is the real one.
   *
   * Salary is withheld under a client filter for the same reason the salary
   * block itself is (payroll is a whole-company bill, not work done for one
   * client), and the block says so rather than quietly showing wages that
   * exclude it.
   */
  type PnlRow = {
    key: EmploymentType | "unset";
    label: string;
    actualHours: number;
    billedHours: number;
    hourlyWages: number;
    salary: number;
    revenue: number;
    /** Someone in this bucket has no pay rate on file, so `hourlyWages` is knowingly short. */
    hasUnpricedWork: boolean;
  };

  const pnlByEmployment: PnlRow[] = (() => {
    const map = new Map<EmploymentType | "unset", PnlRow>();
    const bucket = (key: EmploymentType | "unset") => {
      const existing = map.get(key);
      if (existing) return existing;
      const created: PnlRow = {
        key,
        label: EMPLOYMENT_LABELS[key],
        actualHours: 0,
        billedHours: 0,
        hourlyWages: 0,
        salary: 0,
        revenue: 0,
        hasUnpricedWork: false,
      };
      map.set(key, created);
      return created;
    };

    // The hourly side comes straight from the entries — same source as the
    // grand totals, so the two can't disagree.
    for (const e of pricedProfitEntries) {
      const row = bucket(employmentByUser.get(e.userId)?.employmentType ?? "unset");
      row.actualHours += e.actualHours;
      row.billedHours += e.billedHours;
      row.hourlyWages += e.cost ?? 0;
      row.revenue += e.revenue ?? 0;
      if (e.costBasis === "unpriced") row.hasUnpricedWork = true;
    }

    // The salary side accrues per week, over every week in range rather than
    // the filtered `salaryWeeks` — a week dropped there contributes no salary
    // anyway, so the two still total the same.
    if (salariesApply) {
      const weeks = weeksInRange(from, to);
      for (const employment of salariedMembers) {
        const row = bucket(employment.employmentType);
        for (const week of weeks) {
          row.salary += salaryAccrualForWeek(employment, week).salary;
        }
      }
    }

    return EMPLOYMENT_ORDER.flatMap((key) => {
      const row = map.get(key);
      return row ? [row] : [];
    });
  })();

  const pnlTotals = pnlByEmployment.reduce(
    (acc, r) => ({
      actualHours: acc.actualHours + r.actualHours,
      billedHours: acc.billedHours + r.billedHours,
      hourlyWages: acc.hourlyWages + r.hourlyWages,
      salary: acc.salary + r.salary,
      revenue: acc.revenue + r.revenue,
    }),
    { actualHours: 0, billedHours: 0, hourlyWages: 0, salary: 0, revenue: 0 },
  );

  const pnlCost = (r: { hourlyWages: number; salary: number }) => r.hourlyWages + r.salary;

  // An empty-looking cost cell means one of two opposite things: nobody has
  // entered a pay rate, or the person is salaried and charged in the block
  // below. Saying "—" for both would hide a real gap behind a handled one.
  const costCellLabel = (r: { costKnown: boolean; cost: number; salariedHours: number }) => {
    if (!r.costKnown) return r.salariedHours > 0 ? "Salary" : "—";
    return r.salariedHours > 0
      ? `${formatCurrency(r.cost, settings.currency)} + salary`
      : formatCurrency(r.cost, settings.currency);
  };

  const combinedTotals = {
    cost: profitGrandTotals.cost + retainerTotals.cost + salaryTotals.salary,
    revenue: profitGrandTotals.revenue + retainerTotals.revenue,
    profit: profitGrandTotals.profit + retainerTotals.profit - salaryTotals.salary,
  };

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
  // M48: gross profit reads `detailedEntries`, which detailedEntriesForRange
  // caps. A truncated money report is worse than none, so hitting the cap
  // suppresses the numbers rather than quietly under-reporting them.
  const profitTruncated =
    view === "profit" && (detailedEntries?.length ?? 0) >= DETAILED_ENTRIES_LIMIT;
  const total =
    view === "project"
      ? projectRows.reduce((s, r) => s + r.hours, 0)
      : view === "employee"
        ? employeeRows.reduce((s, r) => s + r.hours, 0)
        : view === "casual"
          ? casualTotalBillableHours
          : view === "profit"
            ? profitGrandTotals.actualHours
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
  const toggleCasualSort = (key: CasualSortKey) => {
    if (key === casualSortKey) setCasualAsc((v) => !v);
    else {
      setCasualSortKey(key);
      setCasualAsc(false);
    }
  };
  const casualSortHeader = (key: CasualSortKey, label: string) => (
    <button onClick={() => toggleCasualSort(key)} className="hover:text-foreground">
      {label}
      {casualSortKey === key ? (casualAsc ? " ↑" : " ↓") : ""}
    </button>
  );

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
    } else if (view === "profit") {
      downloadCsv(`ironbrij-gross-profit-by-${profitGroupBy}_${clientLabel}_${from}_to_${to}.csv`, [
        [
          profitGroupByLabels[profitGroupBy],
          "Client",
          // M51: both hour figures, side by side and labelled, because the
          // whole margin story is the difference between them. A single
          // "Hours" column would leave a reader unable to tell whether the
          // wages or the invoice had been computed from it.
          "Actual Hours",
          "Billed Hours",
          `Pay Rate (${settings.currency})`,
          `Actual Wages (${settings.currency})`,
          `Invoice Rate (${settings.currency})`,
          `Revenue (${settings.currency})`,
          `Gross Profit (${settings.currency})`,
          "Margin %",
          "Unpriced Hours",
          "Date range",
        ],
        // Flattened in the order shown on screen, each group's subtotal
        // following its own rows, same as the casual export.
        ...profitGroups.flatMap((g) => [
          ...g.rows.map((r) => [
            g.label,
            r.clientLabel,
            r.actualHours.toFixed(2),
            r.billedHours.toFixed(2),
            // The blended pay rate divides cost by actual hours, since that
            // is what cost was computed from. Dividing by billed hours here
            // would print a rate 20% below what the VA is really paid.
            r.costKnown && r.actualHours > 0
              ? (r.cost / r.actualHours).toFixed(2)
              : r.salariedHours > 0
                ? "Salary"
                : "No rate set",
            r.costKnown ? r.cost.toFixed(2) : r.salariedHours > 0 ? "Salary" : "No rate set",
            r.ratedHours > 0 ? (r.revenue / r.ratedHours).toFixed(2) : "No rate set",
            r.ratedHours > 0 ? r.revenue.toFixed(2) : "No rate set",
            r.profit.toFixed(2),
            r.revenue > 0 ? ((r.profit / r.revenue) * 100).toFixed(1) : "",
            r.unpricedHours.toFixed(2),
            `${from} to ${to}`,
          ]),
          [
            `${g.label} — total`,
            "",
            g.actualHours.toFixed(2),
            g.billedHours.toFixed(2),
            "",
            g.costKnown ? g.cost.toFixed(2) : g.salariedHours > 0 ? "Salary" : "No rate set",
            "",
            g.ratedHours > 0 ? g.revenue.toFixed(2) : "No rate set",
            g.profit.toFixed(2),
            g.revenue > 0 ? ((g.profit / g.revenue) * 100).toFixed(1) : "",
            g.unpricedHours.toFixed(2),
            `${from} to ${to}`,
          ],
        ]),
        // M51: the profit-and-loss split, appended as its own block for
        // the same reason retainers and salaries already are — the screen
        // shows it, so the export has to, or the two disagree.
        ...(pnlByEmployment.length > 0
          ? [
              [],
              ["Profit & loss by employment type"],
              [
                "Employment type",
                "Actual Hours",
                "Billed Hours",
                `Actual Wages (${settings.currency})`,
                `Salary (${settings.currency})`,
                `Total Cost (${settings.currency})`,
                `Revenue (${settings.currency})`,
                `Gross Profit (${settings.currency})`,
              ],
              ...pnlByEmployment.map((r) => [
                // The asterisk the table shows can't survive a CSV, so the
                // gap it flags is spelled out in the row itself.
                r.hasUnpricedWork ? `${r.label} (some work has no pay rate)` : r.label,
                r.actualHours.toFixed(2),
                r.billedHours.toFixed(2),
                r.hourlyWages.toFixed(2),
                r.salary.toFixed(2),
                pnlCost(r).toFixed(2),
                r.revenue.toFixed(2),
                (r.revenue - pnlCost(r)).toFixed(2),
              ]),
              [
                "P&L total",
                pnlTotals.actualHours.toFixed(2),
                pnlTotals.billedHours.toFixed(2),
                pnlTotals.hourlyWages.toFixed(2),
                pnlTotals.salary.toFixed(2),
                pnlCost(pnlTotals).toFixed(2),
                pnlTotals.revenue.toFixed(2),
                (pnlTotals.revenue - pnlCost(pnlTotals)).toFixed(2),
              ],
            ]
          : []),
        // M49: retainers appended as their own labelled block, then the
        // combined total — the same thing the screen shows, in the same
        // order, so an exported file and a screenshot can't disagree.
        ...(retainersApply && retainerRows.length > 0
          ? [
              [],
              ["Retainers (monthly placements accrued across the range)"],
              [
                "Client",
                "VA",
                "Days",
                `Cost (${settings.currency})`,
                `Revenue (${settings.currency})`,
                `Management Fee (${settings.currency})`,
              ],
              ...retainerRows.map((r) => [
                r.clientLabel,
                r.vaLabel,
                r.days,
                r.cost.toFixed(2),
                r.revenue.toFixed(2),
                r.profit.toFixed(2),
              ]),
              [
                "Retainer total",
                "",
                "",
                retainerTotals.cost.toFixed(2),
                retainerTotals.revenue.toFixed(2),
                retainerTotals.profit.toFixed(2),
              ],
            ]
          : []),
        ...(salariesApply && salaryWeeks.length > 0
          ? [
              [],
              ["Weekly salaries (fixed payroll, prorated by days in range)"],
              [
                "Week",
                "Days",
                "People",
                `Gross profit (${settings.currency})`,
                `Salaries (${settings.currency})`,
                `Net (${settings.currency})`,
              ],
              ...salaryWeeks.map((w) => [
                w.label,
                w.days,
                w.headcount,
                w.hourlyProfit.toFixed(2),
                w.salary.toFixed(2),
                w.net.toFixed(2),
              ]),
              [
                "Range total",
                "",
                "",
                salaryTotals.hourlyProfit.toFixed(2),
                salaryTotals.salary.toFixed(2),
                salaryTotals.net.toFixed(2),
              ],
            ]
          : []),
        ...(retainersApply
          ? [
              [],
              [
                "Total profit (hourly + retainer − salaries)",
                "",
                "",
                combinedTotals.cost.toFixed(2),
                combinedTotals.revenue.toFixed(2),
                combinedTotals.profit.toFixed(2),
              ],
            ]
          : []),
      ]);
    } else if (view === "detailed") {
      // The full filtered set, not just the current page — pagination is a
      // display convenience, not a limit on what the export should contain.
      downloadCsv(`ironbrij-detailed-entries_${clientLabel}_${from}_to_${to}.csv`, [
        ["Date", "Employee", "Project", "Tags", "Task", "Description", "Hours", "Billable"],
        ...filteredDetailed.map((r) => [
          r.date,
          r.employeeName,
          r.projectName,
          r.projectTags.map((t) => t.name).join(", "),
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
            "Tags",
            "Entries",
            "Raw Hours",
            "Billable Hours (uplifted & rounded)",
            "Paid",
            "Unpaid",
            "Date range",
          ],
          // Flattened in the order shown on screen, with each group's
          // subtotal following its categories so the export matches what
          // was on screen when it was taken.
          ...sortedCasualGroups.flatMap((g) => [
            ...g.categories.map((r) => [
              g.groupLabel,
              CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory],
              g.tags.map((t) => t.name).join(", "),
              r.entryCount,
              r.rawHours.toFixed(2),
              r.billableHours.toFixed(2),
              r.paidCount,
              r.entryCount - r.paidCount,
              `${from} to ${to}`,
            ]),
            [
              g.groupLabel,
              "Total",
              g.tags.map((t) => t.name).join(", "),
              g.entryCount,
              g.rawHours.toFixed(2),
              g.billableHours.toFixed(2),
              g.paidCount,
              g.entryCount - g.paidCount,
              `${from} to ${to}`,
            ],
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
              <TabsTrigger value="profit">Gross Profit</TabsTrigger>
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
          {tags.length > 0 && (
            <Select value={detailedTagFilter} onValueChange={setDetailedTagFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* M46: Group by + category filter only apply to the Casual Service
          view, same reasoning the Detailed-only row above already
          establishes for keeping tab-specific filters off the shared row. */}
      {view === "profit" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Select value={profitGroupBy} onValueChange={(v) => setProfitGroupBy(v as ProfitGroupBy)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="va">Group by VA</SelectItem>
              <SelectItem value="client">Group by client</SelectItem>
              <SelectItem value="team">Group by team</SelectItem>
              <SelectItem value="service">Group by service line</SelectItem>
              <SelectItem value="employment">Group by employment type</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {/* M51: this used to say cost and revenue both use the rounded
                hours. They no longer do, and that difference is the whole
                point of the two hour columns. */}
            Wages are costed on actual tracked hours; revenue is invoiced on billed hours
            {settings.clientBillingUpliftPct > 0
              ? ` (casual work plus ${settings.clientBillingUpliftPct}%, rounded up)`
              : " (casual work rounded up)"}
            . Work with no invoice rate on file counts as cost only.
            {profitGroupBy === "team" &&
              " Someone on more than one team is counted under each — group totals will add up to more than the grand total."}
          </p>
        </div>
      )}

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
          {tags.length > 0 && (
            <Select value={casualTagFilter} onValueChange={setCasualTagFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-left font-medium">Employee</th>
                    <th className="px-5 py-3 text-left font-medium">Project</th>
                    {tags.length > 0 && <th className="px-5 py-3 text-left font-medium">Tags</th>}
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
                      {tags.length > 0 && (
                        <td className="px-5 py-3">
                          {r.projectTags.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.projectTags.map((t) => (
                                <span
                                  key={t.id}
                                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                                  style={{
                                    backgroundColor: `color-mix(in oklab, ${t.color} 14%, transparent)`,
                                    color: t.color,
                                  }}
                                >
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      )}
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
                        colSpan={tags.length > 0 ? 8 : 7}
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
      ) : view === "casual" ? (
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
              <CardTitle className="text-base">
                Billable hours by {casualGroupByChartLabels[casualGroupBy]} · {rangeLabel}
              </CardTitle>
            </CardHeader>
            <CardContent className="h-64 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={casualGroupChartData}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="axisLabel"
                    interval={casualChartTickInterval}
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
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as { groupLabel?: string } | undefined)?.groupLabel ??
                      ""
                    }
                    formatter={(value) => [`${(value as number).toFixed(1)} h`, "Billable"]}
                  />
                  <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                    {casualGroupChartData.map((d) => (
                      <Cell key={d.groupKey} fill={d.color} />
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
                Ad-hoc work billed outside the standard subscription retainer. "Billable Hours" adds
                the workspace's client billing uplift
                {settings.clientBillingUpliftPct > 0
                  ? ` (${settings.clientBillingUpliftPct}%)`
                  : ""}{" "}
                and then rounds up to the billing increment, for every category except Ironbrij
                (internal, never billed) — raw tracked hours are shown alongside for reference and
                are never overwritten.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">
                      {casualSortHeader("group", casualGroupByLabels[casualGroupBy])}
                    </th>
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    {tags.length > 0 && <th className="px-5 py-3 text-left font-medium">Tags</th>}
                    <th className="px-5 py-3 text-right font-medium">
                      {casualSortHeader("entries", "Entries")}
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      {casualSortHeader("rawHours", "Raw Hours")}
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      {casualSortHeader("billableHours", "Billable Hours")}
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      {casualSortHeader("paid", "Paid")}
                    </th>
                    {casualGroupBy === "client" && (
                      <th className="px-5 py-3 text-left font-medium">Last Service</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedCasualGroups.map((g) => {
                    // A group with one category would repeat itself exactly
                    // in the detail row below, so it collapses into a
                    // single row naming that category instead.
                    const singleCategory = g.categories.length === 1;
                    return (
                      <Fragment key={g.groupKey}>
                        <tr className="border-b border-border bg-muted/30">
                          <td className="px-5 py-3 font-semibold">{g.groupLabel}</td>
                          <td className="px-5 py-3 text-muted-foreground">
                            {singleCategory
                              ? CASUAL_SERVICE_CATEGORY_LABELS[g.categories[0].serviceCategory]
                              : `${g.categories.length} categories`}
                          </td>
                          {tags.length > 0 && (
                            <td className="px-5 py-3">
                              {g.tags.length === 0 ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {g.tags.map((t) => (
                                    <span
                                      key={t.id}
                                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                                      style={{
                                        backgroundColor: `color-mix(in oklab, ${t.color} 14%, transparent)`,
                                        color: t.color,
                                      }}
                                    >
                                      {t.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          )}
                          <td className="px-5 py-3 text-right tabular-nums">{g.entryCount}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {formatHours(g.rawHours)}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums">
                            {formatHours(g.billableHours)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {g.paidCount}/{g.entryCount}
                          </td>
                          {casualGroupBy === "client" && (
                            <td className="px-5 py-3 text-muted-foreground">
                              {g.lastServiceDate
                                ? fromDateKey(g.lastServiceDate).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : "—"}
                            </td>
                          )}
                        </tr>
                        {!singleCategory &&
                          g.categories.map((r) => (
                            <tr
                              key={r.serviceCategory}
                              className="border-b border-border text-muted-foreground hover:bg-muted/40"
                            >
                              <td className="px-5 py-2" />
                              <td className="py-2 pl-9 pr-5">
                                {CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory]}
                              </td>
                              {tags.length > 0 && <td className="px-5 py-2" />}
                              <td className="px-5 py-2 text-right tabular-nums">{r.entryCount}</td>
                              <td className="px-5 py-2 text-right tabular-nums">
                                {formatHours(r.rawHours)}
                              </td>
                              <td className="px-5 py-2 text-right tabular-nums">
                                {formatHours(r.billableHours)}
                              </td>
                              <td className="px-5 py-2 text-right tabular-nums">
                                {r.paidCount}/{r.entryCount}
                              </td>
                              {casualGroupBy === "client" && <td className="px-5 py-2" />}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                  {sortedCasualGroups.length === 0 && (
                    <tr>
                      <td
                        colSpan={(casualGroupBy === "client" ? 7 : 6) + (tags.length > 0 ? 1 : 0)}
                        className="px-5 py-8 text-center text-sm text-muted-foreground"
                      >
                        No casual-service entries in this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
                {sortedCasualGroups.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50">
                      <td className="px-5 py-3 font-semibold">
                        All {sortedCasualGroups.length} {casualGroupByChartLabels[casualGroupBy]}
                        {sortedCasualGroups.length === 1 ? "" : "s"}
                      </td>
                      <td className="px-5 py-3" />
                      {tags.length > 0 && <td className="px-5 py-3" />}
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {casualGrandTotals.entryCount}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(casualGrandTotals.rawHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(casualGrandTotals.billableHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {casualGrandTotals.paidCount}/{casualGrandTotals.entryCount}
                      </td>
                      {casualGroupBy === "client" && <td className="px-5 py-3" />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* M51: profit and loss by employment type. Sits above the main
              table because it answers a different question — "what did this
              period cost us, split by how people are employed" rather than
              "where did the margin come from". */}
          {!profitTruncated && pnlByEmployment.length > 0 && (
            <Card className="mb-4 shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Profit &amp; loss · {rangeLabel}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Actual tracked hours and the wages they cost, split by employment type. Salaried
                  staff cost nothing per hour — their fixed weekly pay is the Salary column, so
                  Total Cost is the real figure for each row.
                  {!salariesApply &&
                    " Salary is withheld while a client filter is active, since payroll isn't work done for one client."}
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[880px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-3 text-left font-medium">Employment type</th>
                      <th className="px-5 py-3 text-right font-medium">Actual Hours</th>
                      <th className="px-5 py-3 text-right font-medium">Billed Hours</th>
                      <th className="px-5 py-3 text-right font-medium">Actual Wages</th>
                      <th className="px-5 py-3 text-right font-medium">Salary</th>
                      <th className="px-5 py-3 text-right font-medium">Total Cost</th>
                      <th className="px-5 py-3 text-right font-medium">Revenue</th>
                      <th className="px-5 py-3 text-right font-medium">Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnlByEmployment.map((r) => (
                      <tr key={r.key} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 font-medium">{r.label}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatHours(r.actualHours)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatHours(r.billedHours)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatCurrency(r.hourlyWages, settings.currency)}
                          {r.hasUnpricedWork && (
                            <span
                              className="ml-1 text-muted-foreground"
                              title="Someone in this group has no pay rate on file, so this is lower than the real figure"
                            >
                              *
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                          {r.salary > 0 ? formatCurrency(r.salary, settings.currency) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums">
                          {formatCurrency(pnlCost(r), settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {formatCurrency(r.revenue, settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(r.revenue - pnlCost(r), settings.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50">
                      <td className="px-5 py-3 font-semibold">Total</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(pnlTotals.actualHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(pnlTotals.billedHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(pnlTotals.hourlyWages, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(pnlTotals.salary, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(pnlCost(pnlTotals), settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(pnlTotals.revenue, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(pnlTotals.revenue - pnlCost(pnlTotals), settings.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-card">
            <CardContent className="overflow-x-auto p-0">
              {profitTruncated && (
                <p className="border-b border-border bg-destructive/10 px-5 py-3 text-sm text-destructive">
                  This range has more entries than a single report can load, so these totals would
                  be incomplete. Narrow the date range and try again.
                </p>
              )}
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 text-left font-medium">
                      {profitGroupByLabels[profitGroupBy]}
                    </th>
                    <th className="px-5 py-3 text-left font-medium">Client</th>
                    {/* M51: "Actual" and "Billed" rather than one "Hours"
                        column — the gap between them is the uplift, and
                        which one a money column was computed from is the
                        difference between a correct figure and a 20%
                        error. */}
                    <th className="px-5 py-3 text-right font-medium">Actual Hours</th>
                    <th className="px-5 py-3 text-right font-medium">Billed Hours</th>
                    <th className="px-5 py-3 text-right font-medium">Pay Rate</th>
                    <th className="px-5 py-3 text-right font-medium">Actual Wages</th>
                    <th className="px-5 py-3 text-right font-medium">Invoice Rate</th>
                    <th className="px-5 py-3 text-right font-medium">Revenue</th>
                    <th className="px-5 py-3 text-right font-medium">Gross Profit</th>
                    <th className="px-5 py-3 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profitTruncated ? null : profitGroups.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-5 py-8 text-center text-sm text-muted-foreground"
                      >
                        No tracked hours in this range.
                      </td>
                    </tr>
                  ) : (
                    profitGroups.map((g) => {
                      // A group with a single client would repeat itself
                      // exactly in the detail row below, so it collapses.
                      const single = g.rows.length === 1;
                      return (
                        <Fragment key={g.key}>
                          <tr className="border-b border-border bg-muted/30">
                            <td className="px-5 py-3 font-semibold">{g.label}</td>
                            <td className="px-5 py-3 text-muted-foreground">
                              {single ? g.rows[0].clientLabel : `${g.rows.length} clients`}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {formatHours(g.actualHours)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {formatHours(g.billedHours)}
                            </td>
                            <td className="px-5 py-3" />
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {costCellLabel(g)}
                            </td>
                            <td className="px-5 py-3" />
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {g.ratedHours > 0
                                ? formatCurrency(g.revenue, settings.currency)
                                : "—"}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold tabular-nums">
                              {formatCurrency(g.profit, settings.currency)}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                              {g.revenue > 0
                                ? `${((g.profit / g.revenue) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                          {!single &&
                            g.rows.map((r) => (
                              <tr
                                key={r.key}
                                className="border-b border-border last:border-0 hover:bg-muted/40"
                              >
                                <td className="px-5 py-3" />
                                <td className="py-3 pl-9 pr-5">{r.clientLabel}</td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  {formatHours(r.actualHours)}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  {formatHours(r.billedHours)}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                                  {/* Divided by actual hours, matching what
                                      cost is computed from — billed hours
                                      here would understate the rate by the
                                      uplift. */}
                                  {r.costKnown && r.actualHours > 0
                                    ? formatCurrency(r.cost / r.actualHours, settings.currency)
                                    : "—"}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  {costCellLabel(r)}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                                  {r.ratedHours > 0 ? (
                                    formatCurrency(r.revenue / r.ratedHours, settings.currency)
                                  ) : (
                                    <span title="No invoice rate on file for this client">—</span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  {r.ratedHours > 0
                                    ? formatCurrency(r.revenue, settings.currency)
                                    : "—"}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  {formatCurrency(r.profit, settings.currency)}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                                  {r.revenue > 0
                                    ? `${((r.profit / r.revenue) * 100).toFixed(1)}%`
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                {!profitTruncated && profitGroups.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50">
                      <td className="px-5 py-3 font-semibold">Total</td>
                      <td className="px-5 py-3" />
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(profitGrandTotals.actualHours)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatHours(profitGrandTotals.billedHours)}
                      </td>
                      <td className="px-5 py-3" />
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(profitGrandTotals.cost, settings.currency)}
                      </td>
                      <td className="px-5 py-3" />
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(profitGrandTotals.revenue, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(profitGrandTotals.profit, settings.currency)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {profitGrandTotals.revenue > 0
                          ? `${((profitGrandTotals.profit / profitGrandTotals.revenue) * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>

          {/* M49: retainers sit in their own table because a monthly
            placement has no hours — folding it into the hourly grid above
            would leave that grid's Hours and blended-rate columns
            meaningless. The combined total below is what ties them
            together. */}
          {!profitTruncated && (
            <Card className="mt-6 shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Retainers — monthly placements, accrued across this range
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {!retainersApply ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Retainers aren&apos;t shown while a team filter is on — placed VAs aren&apos;t
                    IronTrack members, so they don&apos;t belong to a team. Clear the team filter to
                    include them.
                  </p>
                ) : retainerRows.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No placements were live during this range.
                  </p>
                ) : (
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-3 text-left font-medium">Client</th>
                        <th className="px-5 py-3 text-left font-medium">VA</th>
                        <th className="px-5 py-3 text-right font-medium">Days</th>
                        <th className="px-5 py-3 text-right font-medium">Cost</th>
                        <th className="px-5 py-3 text-right font-medium">Revenue</th>
                        <th className="px-5 py-3 text-right font-medium">Management Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retainerRows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-border last:border-0 hover:bg-muted/40"
                        >
                          <td className="px-5 py-3 font-medium">{r.clientLabel}</td>
                          <td className="px-5 py-3">{r.vaLabel}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {r.days}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {formatCurrency(r.cost, settings.currency)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {formatCurrency(r.revenue, settings.currency)}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums">
                            {formatCurrency(r.profit, settings.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/50">
                        <td className="px-5 py-3 font-semibold" colSpan={3}>
                          Retainer total
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(retainerTotals.cost, settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(retainerTotals.revenue, settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(retainerTotals.profit, settings.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* M50: the workbook's Net Loss line. Weekly rather than one lump
            because the question is "did casual work cover payroll this
            week" — a range total averages a bad week away against a good
            one, which is exactly what the accounts team is looking for. */}
          {!profitTruncated && (
            <Card className="mt-6 shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Weekly salaries — fixed payroll against gross profit
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {!salariesApply ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Salaries aren&apos;t shown while a client filter is on — payroll is a
                    whole-company bill, not work done for one client. Clear the client filter to
                    include it.
                  </p>
                ) : salaryWeeks.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Nobody had a weekly salary during this range. Set one in Manage → Schedule to
                    see payroll netted off here.
                  </p>
                ) : (
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-3 text-left font-medium">Week</th>
                        <th className="px-5 py-3 text-right font-medium">Days</th>
                        <th className="px-5 py-3 text-right font-medium">People</th>
                        <th className="px-5 py-3 text-right font-medium">Gross profit</th>
                        <th className="px-5 py-3 text-right font-medium">Salaries</th>
                        <th className="px-5 py-3 text-right font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salaryWeeks.map((w) => (
                        <tr
                          key={w.weekStart}
                          className="border-b border-border last:border-0 hover:bg-muted/40"
                        >
                          <td className="px-5 py-3 font-medium">{w.label}</td>
                          {/* A short leading or trailing week is shown as short
                            so it doesn't read as a payroll discrepancy. */}
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {w.days < 7 ? `${w.days}/7` : w.days}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                            {w.headcount}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {formatCurrency(w.hourlyProfit, settings.currency)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {formatCurrency(w.salary, settings.currency)}
                          </td>
                          <td
                            className={`px-5 py-3 text-right font-semibold tabular-nums ${
                              w.net < 0 ? "text-destructive" : ""
                            }`}
                          >
                            {formatCurrency(w.net, settings.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/50">
                        <td className="px-5 py-3 font-semibold" colSpan={3}>
                          Range total
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(salaryTotals.hourlyProfit, settings.currency)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(salaryTotals.salary, settings.currency)}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-semibold tabular-nums ${
                            salaryTotals.net < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatCurrency(salaryTotals.net, settings.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {!profitTruncated && retainersApply && (
            <Card className="mt-6 shadow-card">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold">
                    Total profit — hourly and retainer, after salaries
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(profitGrandTotals.profit, settings.currency)} hourly +{" "}
                    {formatCurrency(retainerTotals.profit, settings.currency)} retainer
                    {salaryTotals.salary > 0
                      ? ` − ${formatCurrency(salaryTotals.salary, settings.currency)} salaries`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-8 tabular-nums">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Cost</p>
                    <p className="font-semibold">
                      {formatCurrency(combinedTotals.cost, settings.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p className="font-semibold">
                      {formatCurrency(combinedTotals.revenue, settings.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Gross profit</p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(combinedTotals.profit, settings.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Margin</p>
                    <p className="font-semibold">
                      {combinedTotals.revenue > 0
                        ? `${((combinedTotals.profit / combinedTotals.revenue) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
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
