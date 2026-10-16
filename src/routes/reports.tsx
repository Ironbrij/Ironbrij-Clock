import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, Download } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { placementFiguresForRange } from "@/lib/retainer";
import { placementWeekKey } from "@/lib/workspace/use-placements";
import { salaryAccrualForWeek, weeksInRange } from "@/lib/weekly-salary";
import { formatHours } from "@/lib/mock-data";
import { addDays, formatWeekRange, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import {
  DETAILED_ENTRIES_LIMIT,
  useClientBudgets,
  useWorkspace,
  type DetailedEntry,
} from "@/lib/workspace-store";
import {
  CASUAL_SERVICE_CATEGORY_LABELS,
  dotColors,
  NO_CLIENT,
  type CasualServiceCategory,
} from "@/lib/workspace/types";
import { CasualReportView } from "@/components/reports/casual-report-view";
import { ClientFacingReportView } from "@/components/reports/client-facing-report-view";
import { DetailedReportView } from "@/components/reports/detailed-report-view";
import { EmployeeReportView } from "@/components/reports/employee-report-view";
import { ProfitReportView } from "@/components/reports/profit-report-view";
import { ProjectReportView } from "@/components/reports/project-report-view";
import {
  AUDIENCE_LABELS,
  CASUAL_CHART_MAX_BARS,
  CASUAL_CHART_MAX_TICKS,
  DEPARTMENT_LABELS,
  DEPARTMENT_ORDER,
  DETAILED_PAGE_SIZE,
  EMPLOYMENT_LABELS,
  SERVICE_LINE_LABELS,
  casualGroupByLabels,
  computeRange,
  departmentFor,
  downloadCsv,
  filterByAudience,
  formatCurrency,
  isInternalWork,
  presetLabels,
  profitGroupByLabels,
  rangePresets,
  reportAudiences,
  reportViews,
  truncateChartLabel,
  type CasualSortKey,
  type DepartmentKey,
  type EmployeeSortKey,
  type ExportHoursBasis,
  type ProfitGroupBy,
  type ProjectSortKey,
  type RangePreset,
  type ReportAudience,
  type ReportView,
} from "@/components/reports/report-config";
import type {
  CasualGroup,
  ClientFacingRow,
  DepartmentRow,
  ProfitGroup,
  ProfitRow,
} from "@/components/reports/report-rows";

/**
 * The report's tab, range and shared filters, mirrored into the URL so a
 * refresh keeps them and a filtered report can be shared as a link. Every
 * key is optional and omitted at its default, so a plain /reports link is
 * unchanged. Unknown values are dropped rather than trusted.
 */
type ReportsSearch = {
  view?: ReportView;
  range?: RangePreset;
  from?: string;
  to?: string;
  team?: string;
  client?: string;
  tag?: string;
  audience?: ReportAudience;
};

const isDateKey = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const optionalString = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    view: reportViews.includes(search.view as ReportView) ? (search.view as ReportView) : undefined,
    range: rangePresets.includes(search.range as RangePreset)
      ? (search.range as RangePreset)
      : undefined,
    from: isDateKey(search.from) ? search.from : undefined,
    to: isDateKey(search.to) ? search.to : undefined,
    team: optionalString(search.team),
    client: optionalString(search.client),
    tag: optionalString(search.tag),
    audience: reportAudiences.includes(search.audience as ReportAudience)
      ? (search.audience as ReportAudience)
      : undefined,
  }),
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

function Reports() {
  // Seeded once from the URL (see ReportsSearch); the effect further down
  // mirrors every change back into it.
  const initialSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  // `requestedView` is what the URL/tabs asked for; `view` (below, once
  // canManage is known) is what actually renders — a Member following a
  // manager's link to a manager-only tab gets By project instead of an
  // empty table.
  const [requestedView, setView] = useState<ReportView>(initialSearch.view ?? "project");
  const [preset, setPreset] = useState<RangePreset>(initialSearch.range ?? "this_month");
  const todayKey = toDateKey(new Date());
  const [customFrom, setCustomFrom] = useState(initialSearch.from ?? todayKey);
  const [customTo, setCustomTo] = useState(initialSearch.to ?? todayKey);
  const [teamFilter, setTeamFilter] = useState(initialSearch.team ?? "all");
  const [clientFilter, setClientFilter] = useState(initialSearch.client ?? "all");
  /**
   * M51: one tag filter for every tab, rather than the separate
   * Detailed-only and Casual-only pickers this replaces.
   *
   * Promoted to the shared row because it now reaches the Project and
   * Employee tabs too, and those read pre-aggregated SUMs from SQL — their
   * filtering happens server-side via the RPCs' new `_tag_id`, so a
   * per-tab picker would have meant three separate controls doing the same
   * thing by three different mechanisms. A single selection also survives
   * switching tabs, which the per-tab ones did not.
   */
  const [tagFilter, setTagFilter] = useState(initialSearch.tag ?? "all");

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
  // O9: the client-facing table could render every entry in range (up to
  // DETAILED_ENTRIES_LIMIT, 5,000 rows) at once. Paged like Detailed; the
  // total row and the CSV export still cover every row.
  const [clientFacingPage, setClientFacingPage] = useState(1);

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
  // 2026-10-16: the hours accounts entered per placement per week, for the
  // placement block below. A missing week means "use the contracted hours".
  const [placementHours, setPlacementHours] = useState<Map<string, number>>(new Map());
  const [loadingPlacementHours, setLoadingPlacementHours] = useState(true);

  // M51: shared by the three tabs derived from `detailedEntries`. The
  // Project and Employee tabs come from SQL aggregates with no service
  // category in them, so they can't honour this and don't offer it.
  const [audience, setAudience] = useState<ReportAudience>(initialSearch.audience ?? "all");

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
    placementWeekHoursForRange,
    projectHoursForRange,
    projectBillableHoursForRange,
    employeeHoursForRange,
    employeeBillableHoursForRange,
    employeeClientHoursForRange,
    detailedEntriesForRange,
    casualClientLastServiceForAll,
  } = useWorkspace();
  const clientBudgets = useClientBudgets();
  // Only By project is available to non-managers (the tab row is hidden for
  // them), so any other requested tab falls back to it.
  const view: ReportView = canManage ? requestedView : "project";

  // Mirror tab, range and shared filters into the URL. replace, not push,
  // so changing a filter doesn't pile up Back-button history. Defaults are
  // left out so an untouched report keeps a plain /reports URL.
  useEffect(() => {
    void navigate({
      search: {
        view: requestedView === "project" ? undefined : requestedView,
        range: preset === "this_month" ? undefined : preset,
        from: preset === "custom" && customFrom ? customFrom : undefined,
        to: preset === "custom" && customTo ? customTo : undefined,
        team: teamFilter === "all" ? undefined : teamFilter,
        client: clientFilter === "all" ? undefined : clientFilter,
        tag: tagFilter === "all" ? undefined : tagFilter,
        audience: audience === "all" ? undefined : audience,
      },
      replace: true,
    });
  }, [
    navigate,
    requestedView,
    preset,
    customFrom,
    customTo,
    teamFilter,
    clientFilter,
    tagFilter,
    audience,
  ]);

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
    // M51: tag scoping happens server-side for this tab — these are
    // pre-aggregated SUMs, so there are no per-entry tags left to filter
    // by the time the rows reach the client.
    const scopedTag = tagFilter === "all" ? undefined : tagFilter;
    Promise.all([
      projectHoursForRange(from, to, scopedTeam, scopedTag),
      projectBillableHoursForRange(from, to, scopedTeam, scopedTag),
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
  }, [from, to, teamFilter, tagFilter, projectHoursForRange, projectBillableHoursForRange]);

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
    // Same server-side tag scoping as the Project tab above.
    const scopedTag = tagFilter === "all" ? undefined : tagFilter;
    Promise.all([
      employeeHoursForRange(from, to, scopedTag),
      employeeBillableHoursForRange(from, to, scopedTag),
      employeeClientHoursForRange(from, to, scopedTag),
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
    tagFilter,
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

  useEffect(() => {
    if (!canManage) {
      setLoadingPlacementHours(false);
      return;
    }
    let cancelled = false;
    setLoadingPlacementHours(true);
    placementWeekHoursForRange(from, to)
      .then((hours) => {
        if (!cancelled) setPlacementHours(hours);
      })
      .catch((error: Error) => toast.error("Couldn't load report", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoadingPlacementHours(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, canManage, placementWeekHoursForRange]);

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
    tagFilter,
    detailedSearch,
  ]);
  // Same for the client-facing table (Gross Profit → Client-facing only).
  useEffect(() => {
    setClientFacingPage(1);
  }, [from, to, teamFilter, clientFilter, tagFilter, audience]);

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
      clientName: project?.clientId ? project.client : null,
      // The entry's own tag_ids, matching what the tag filter selects on —
      // see joinAndFilterCasualEntries. Since 20261014000000 these always
      // follow the entry's project rather than being a snapshot from when
      // it was logged.
      projectTags: tags
        .filter((t) => e.tagIds.includes(t.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
      employeeName: member?.name ?? "Former member",
      employeeInitials: member?.initials ?? "—",
      employeeAvatarUrl: member?.avatarUrl ?? null,
    };
  });

  const filteredDetailed = filterByAudience(detailedRows, audience)
    .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
    .filter((r) => {
      if (clientFilter === "all") return true;
      if (clientFilter === "none") return r.clientId === null;
      return r.clientId === clientFilter;
    })
    .filter((r) => projectFilter === "all" || r.projectId === projectFilter)
    .filter((r) => employeeFilter === "all" || r.userId === employeeFilter)
    .filter((r) => tagFilter === "all" || r.tagIds.includes(tagFilter))
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
          // Tags come off the entry's own tag_ids. M51 made those "tags at
          // the time"; since 20261014000000 a trigger keeps them in step with
          // the entry's project, and retagging a project can carry the
          // change onto past entries (retag_project_entries).
          entryTagIds: e.tagIds,
        };
      })
      .filter((r) => r.serviceCategory !== null)
      .filter((r) => audience === "all" || isInternalWork(r) === (audience === "internal"))
      .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
      .filter((r) => {
        if (clientFilter === "all") return true;
        if (clientFilter === "none") return r.clientId === null;
        return r.clientId === clientFilter;
      })
      .filter((r) => casualCategoryFilter === "all" || r.serviceCategory === casualCategoryFilter)
      .filter((r) => tagFilter === "all" || r.entryTagIds.includes(tagFilter));
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
    .filter((r) => audience === "all" || isInternalWork(r) === (audience === "internal"))
    .filter((r) => teamFilter === "all" || r.employeeTeamIds.includes(teamFilter))
    .filter((r) => tagFilter === "all" || r.tagIds.includes(tagFilter))
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

  // M49: the placement half of profitability. Since 2026-10-16 placements are
  // priced the way the weekly sheet prices them — hours x VA rate paid, hours
  // x invoice rate invoiced, on each week's entered hours (else contracted) —
  // summed over the range's weeks by placementFiguresForRange. That replaced
  // M49's 365-day accrual of a monthly package, so this block, Billing →
  // Placements and the weekly report all agree. They keep their own section
  // because the hourly table above is built from time entries, and the two
  // profits are summed into a combined total.
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
      ...placementFiguresForRange(
        p,
        from,
        to,
        (weekStart) => placementHours.get(placementWeekKey(p.id, weekStart)) ?? null,
      ),
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
   * M52: gross profit by department — the workbook's own Gross Profit sheet
   * layout, and where the confirmed formula lands: pay rate × actual hours is
   * what the VA is paid, invoice rate × billed hours is what the client is
   * invoiced, and the difference is the margin.
   *
   * Replaces M51's split by employment type, which this is a superset of: the
   * Full-time and Part-time rows are still here, they just no longer absorb
   * the casual-programme work those same people do, which the sheet reports
   * under Casual and VIP. Every entry lands in exactly one row, so these
   * totals still tie out to the grand totals below.
   *
   * Salaried payroll gets its own row rather than being spread across the
   * full-time and part-time ones. A fixed weekly wage isn't attributable to
   * the hours someone happened to log that week, and since M52 those two rows
   * don't even contain all of that person's work — charging a whole salary
   * against part of it would overstate the department. Withheld under a client
   * filter, the same rule the salary block itself uses.
   */

  const departmentRows: DepartmentRow[] = (() => {
    const map = new Map<DepartmentKey, DepartmentRow>();
    const bucket = (key: DepartmentKey) => {
      const existing = map.get(key);
      if (existing) return existing;
      const created: DepartmentRow = {
        key,
        label: DEPARTMENT_LABELS[key],
        actualHours: 0,
        billedHours: 0,
        paid: 0,
        invoice: 0,
        hasUnpricedWork: false,
        salariedHours: 0,
      };
      map.set(key, created);
      return created;
    };

    // Straight from the entries — the same source as the grand totals, so
    // the two can't disagree.
    for (const e of pricedProfitEntries) {
      const row = bucket(departmentFor(e, employmentByUser.get(e.userId)?.employmentType));
      row.actualHours += e.actualHours;
      row.billedHours += e.billedHours;
      row.paid += e.cost ?? 0;
      row.invoice += e.revenue ?? 0;
      if (e.costBasis === "unpriced") row.hasUnpricedWork = true;
      if (e.costBasis === "salary") row.salariedHours += e.actualHours;
    }

    const rows: DepartmentRow[] = DEPARTMENT_ORDER.flatMap((key) => {
      const row = map.get(key);
      return row ? [row] : [];
    });

    // Accrued over every week in range rather than the filtered
    // `salaryWeeks`, same as M51's block: a week dropped there contributes no
    // salary anyway, so the two still total the same.
    if (salariesApply && salariedMembers.length > 0) {
      const weeks = weeksInRange(from, to);
      let salary = 0;
      for (const employment of salariedMembers) {
        for (const week of weeks) {
          salary += salaryAccrualForWeek(employment, week).salary;
        }
      }
      if (salary > 0) {
        rows.push({
          key: "salary",
          label: "Salaried payroll (all departments)",
          actualHours: 0,
          billedHours: 0,
          paid: salary,
          invoice: 0,
          hasUnpricedWork: false,
          salariedHours: 0,
        });
      }
    }

    return rows;
  })();

  const departmentTotals = departmentRows.reduce(
    (acc, r) => ({
      actualHours: acc.actualHours + r.actualHours,
      billedHours: acc.billedHours + r.billedHours,
      paid: acc.paid + r.paid,
      invoice: acc.invoice + r.invoice,
    }),
    { actualHours: 0, billedHours: 0, paid: 0, invoice: 0 },
  );

  /**
   * M51: the client-facing deliverable — "export without cost, gross profit
   * for clients / name, hours, task name, remaining hours".
   *
   * Built as its own projection rather than as the profit table with columns
   * hidden. That is the whole safety property: this type has no cost, rate,
   * wage or margin field at all, so a column added to `ProfitRow` later
   * cannot accidentally surface in something sent to a client. Hiding cells
   * in a shared table would make that a one-line mistake away.
   *
   * Sourced from `filteredDetailed` with internal work removed
   * unconditionally — not via `audience`. Every other filter the person set
   * still applies, but internal work can never appear here even if the
   * audience control says "All work".
   */

  const clientFacingRows: ClientFacingRow[] = (() => {
    const map = new Map<string, ClientFacingRow>();
    for (const e of filteredDetailed) {
      if (isInternalWork(e)) continue;
      // Description is part of the grouping key, not just displayed: a VA's
      // "Design" work for a client is several distinct pieces of work, and
      // collapsing them onto one line would throw away the very detail this
      // column exists to show. It does mean more rows than the task-only
      // grouping this replaces.
      const description = e.description.trim();
      const key = `${e.userId}::${e.clientId ?? "none"}::${e.task}::${description}`;
      const row = map.get(key) ?? {
        key,
        employeeName: e.employeeName,
        clientLabel: e.clientId
          ? (clients.find((c) => c.id === e.clientId)?.name ?? "Unknown client")
          : NO_CLIENT,
        task: e.task || "—",
        description,
        billedHours: 0,
        actualHours: 0,
        // Confirmed as the client's subscription allowance less everything
        // ever rendered against it — deliberately not scoped to this
        // report's date range, so it reads as a standing balance rather
        // than resetting each period.
        remainingHours: e.clientId ? (clientBudgets.get(e.clientId)?.remainingHours ?? null) : null,
      };
      // Per line, before summing — same reasoning as everywhere else the
      // increment is applied.
      row.billedHours += billableHoursForCasualEntry(e, e.serviceCategory, billingOpts);
      row.actualHours += e.hours;
      map.set(key, row);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        a.clientLabel.localeCompare(b.clientLabel) ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.task.localeCompare(b.task) ||
        b.billedHours - a.billedHours,
    );
  })();

  const clientFacingTotalHours = clientFacingRows.reduce((s, r) => s + r.billedHours, 0);
  const clientFacingTotalActualHours = clientFacingRows.reduce((s, r) => s + r.actualHours, 0);
  const totalClientFacingPages = Math.max(
    1,
    Math.ceil(clientFacingRows.length / DETAILED_PAGE_SIZE),
  );
  const currentClientFacingPage = Math.min(clientFacingPage, totalClientFacingPages);
  const pagedClientFacingRows = clientFacingRows.slice(
    (currentClientFacingPage - 1) * DETAILED_PAGE_SIZE,
    currentClientFacingPage * DETAILED_PAGE_SIZE,
  );

  /** True when the Gross Profit tab should render the client-safe view instead of the margin table. */
  const showClientFacing = view === "profit" && audience === "client";

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
          : view === "profit"
            ? loadingDetailed || loadingPlacementHours
            : loadingDetailed;
  // M48: gross profit reads `detailedEntries`, which detailedEntriesForRange
  // caps. A truncated money report is worse than none, so hitting the cap
  // suppresses the numbers rather than quietly under-reporting them.
  // Detailed and Casual Service read the same capped rows. They still render
  // (newest first), but say so rather than pass off a partial total.
  const entriesTruncated = (detailedEntries?.length ?? 0) >= DETAILED_ENTRIES_LIMIT;
  const profitTruncated = view === "profit" && entriesTruncated;
  const total = showClientFacing
    ? // M51: the client view's headline has to be the invoiced figure, not
      // the tracked one, or it contradicts the only column beneath it.
      clientFacingTotalHours
    : view === "project"
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
    <button type="button" onClick={() => toggleCasualSort(key)} className="hover:text-foreground">
      {label}
      <span aria-hidden="true">{casualSortKey === key ? (casualAsc ? " ↑" : " ↓") : ""}</span>
    </button>
  );
  const casualAriaSort = (key: CasualSortKey) =>
    casualSortKey === key ? (casualAsc ? "ascending" : "descending") : undefined;

  /** True for the exports that offer a choice of hours — the rest print one fixed figure, or both side by side. */
  const exportOffersHoursBasis = view === "detailed" || showClientFacing;

  const exportCsv = (basis: ExportHoursBasis = "billed") => {
    // Only set for the exports that offer the choice, so the other filenames
    // are unchanged. Spelled out because the two files otherwise look alike
    // once downloaded — a client copy sent at the wrong basis would be easy to miss.
    const basisLabel = exportOffersHoursBasis
      ? basis === "billed"
        ? "_with-increment"
        : "_actual-hours"
      : "";
    const clientLabel =
      clientFilter === "all"
        ? "all-clients"
        : clientFilter === "none"
          ? "no-client"
          : (clients.find((c) => c.id === clientFilter)?.name.replace(/\s+/g, "-") ?? "client");
    // M51: a tag-filtered export is a different document from an unfiltered
    // one, and nothing inside the file distinguishes them — so the filename
    // has to, the same way the client filter already does. Empty when no tag
    // is selected, so unfiltered filenames are unchanged.
    const tagLabel =
      tagFilter === "all"
        ? ""
        : `_tag-${tags.find((t) => t.id === tagFilter)?.name.replace(/\s+/g, "-") ?? "unknown"}`;
    if (view === "project") {
      downloadCsv(`ironbrij-hours-by-project_${clientLabel}${tagLabel}_${from}_to_${to}.csv`, [
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
      downloadCsv(`ironbrij-hours-by-employee_${clientLabel}${tagLabel}_${from}_to_${to}.csv`, [
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
    } else if (showClientFacing) {
      // M51: the client deliverable. Built only from `clientFacingRows`,
      // which has no cost, rate or margin field to leak — see its own
      // comment for why that is a projection rather than hidden columns.
      // The header stays plain "Hours" in both — this file goes to the
      // client, and the basis is in the filename, not something to explain to them.
      downloadCsv(
        `ironbrij-client-hours_${clientLabel}${tagLabel}${basisLabel}_${from}_to_${to}.csv`,
        [
          ["Name", "Client", "Task", "Description", "Hours", "Remaining Hours", "Date range"],
          ...clientFacingRows.map((r) => [
            r.employeeName,
            r.clientLabel,
            r.task,
            r.description,
            (basis === "billed" ? r.billedHours : r.actualHours).toFixed(2),
            // A client with no subscription allowance has no balance to
            // report, which is not the same as a balance of zero. Already
            // drawn down from tracked time, so it is the same in both files.
            r.remainingHours == null ? "No allowance set" : r.remainingHours.toFixed(2),
            `${from} to ${to}`,
          ]),
          [
            "Total",
            "",
            "",
            "",
            (basis === "billed" ? clientFacingTotalHours : clientFacingTotalActualHours).toFixed(2),
            "",
            `${from} to ${to}`,
          ],
        ],
      );
    } else if (view === "profit") {
      downloadCsv(
        `ironbrij-gross-profit-by-${profitGroupBy}_${clientLabel}${tagLabel}_${from}_to_${to}.csv`,
        [
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
          // M52: the department breakdown, appended as its own block for the
          // same reason retainers and salaries already are — the screen shows
          // it, so the export has to, or the two disagree.
          ...(departmentRows.length > 0
            ? [
                [],
                ["Gross profit by department"],
                [
                  "Department",
                  "Actual Hours",
                  "Billed Hours",
                  `Paid (${settings.currency})`,
                  `Invoice (${settings.currency})`,
                  `Gross Profit (${settings.currency})`,
                ],
                ...departmentRows.map((r) => [
                  // The asterisk the table shows can't survive a CSV, so the
                  // gap it flags is spelled out in the row itself.
                  r.hasUnpricedWork ? `${r.label} (some work has no pay rate)` : r.label,
                  r.key === "salary" ? "" : r.actualHours.toFixed(2),
                  r.key === "salary" ? "" : r.billedHours.toFixed(2),
                  r.paid.toFixed(2),
                  r.key === "salary" ? "" : r.invoice.toFixed(2),
                  (r.invoice - r.paid).toFixed(2),
                ]),
                [
                  "Department total",
                  departmentTotals.actualHours.toFixed(2),
                  departmentTotals.billedHours.toFixed(2),
                  departmentTotals.paid.toFixed(2),
                  departmentTotals.invoice.toFixed(2),
                  (departmentTotals.invoice - departmentTotals.paid).toFixed(2),
                ],
              ]
            : []),
          // M49: retainers appended as their own labelled block, then the
          // combined total — the same thing the screen shows, in the same
          // order, so an exported file and a screenshot can't disagree.
          ...(retainersApply && retainerRows.length > 0
            ? [
                [],
                ["Placements (weekly hours × hourly rates, across the range)"],
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
                  "Total",
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
                  "Total profit (hourly + placements − salaries)",
                  "",
                  "",
                  combinedTotals.cost.toFixed(2),
                  combinedTotals.revenue.toFixed(2),
                  combinedTotals.profit.toFixed(2),
                ],
              ]
            : []),
        ],
      );
    } else if (view === "detailed") {
      // The full filtered set, not just the current page — pagination is a
      // display convenience, not a limit on what the export should contain.
      // An internal file, so unlike the client copy the header says which
      // basis it is — the two can end up open side by side.
      downloadCsv(
        `ironbrij-detailed-entries_${clientLabel}${tagLabel}${basisLabel}_${from}_to_${to}.csv`,
        [
          [
            "Date",
            "Employee",
            "Project",
            "Client",
            "Tags",
            "Task",
            "Description",
            basis === "billed" ? "Hours (with increment)" : "Hours (actual)",
            "Billable",
            "Category",
          ],
          ...filteredDetailed.map((r) => [
            r.date,
            r.employeeName,
            r.projectName,
            r.clientName ?? "",
            r.projectTags.map((t) => t.name).join(", "),
            r.task || "",
            r.description || "",
            (basis === "billed"
              ? billableHoursForCasualEntry(r, r.serviceCategory, billingOpts)
              : r.hours
            ).toFixed(2),
            r.billable ? "Yes" : "No",
            r.serviceCategory ? CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory] : "",
          ]),
        ],
      );
    } else {
      downloadCsv(
        `ironbrij-casual-service-by-${casualGroupBy}_${clientLabel}${tagLabel}_${from}_to_${to}.csv`,
        [
          [
            casualGroupByLabels[casualGroupBy],
            "Category",
            "Tags",
            "Entries",
            "Raw Hours",
            "Billable Hours (Paid Casual uplifted & rounded)",
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
        exportOffersHoursBasis ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={loading}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportCsv("billed")}>
                With increment
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportCsv("actual")}>Actual hours</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportCsv()}
            disabled={loading}
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Export
          </Button>
        )
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
          <SelectTrigger className="w-44 gap-2" aria-label="Date range">
            <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
          <SelectTrigger className="w-48" aria-label="Filter by team">
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
          aria-label="Filter by client"
          searchPlaceholder="Search clients…"
          triggerClassName="w-48"
        />
        {/* M51: one tag picker for every tab, replacing the separate
            Detailed-only and Casual-only ones. On the Project and Employee
            tabs this re-runs their RPCs with a _tag_id rather than
            filtering rows here — those tabs only ever see pre-summed
            totals. */}
        {tags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by tag">
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
        {canManage && (
          <Tabs value={view} onValueChange={(v) => setView(v as ReportView)}>
            <TabsList>
              <TabsTrigger value="project">By project</TabsTrigger>
              <TabsTrigger value="employee">By employee</TabsTrigger>
              <TabsTrigger value="detailed">Detailed</TabsTrigger>
              <TabsTrigger value="casual">Casual Service</TabsTrigger>
              <TabsTrigger value="profit">Gross Profit</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span className="text-sm text-muted-foreground" aria-live="polite">
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
            aria-label="Search description or task"
            autoComplete="off"
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
            aria-label="Filter by project"
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
            aria-label="Filter by employee"
            searchPlaceholder="Search employees…"
            triggerClassName="w-48"
          />
        </div>
      )}

      {/* M51: the audience control. Offered on the three tabs derived from
          `detailedEntries` — the Project and Employee tabs come from SQL
          aggregates with no service category in them, so they genuinely
          cannot honour it and don't pretend to. */}
      {(view === "detailed" || view === "casual" || view === "profit") && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Select value={audience} onValueChange={(v) => setAudience(v as ReportAudience)}>
            <SelectTrigger className="w-52" aria-label="Audience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AUDIENCE_LABELS) as ReportAudience[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {AUDIENCE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {audience === "client" ? (
              <>
                Client-facing work only, at billed hours. Every cost, pay rate, wage and margin
                figure is left out of both the table and the export.
              </>
            ) : audience === "internal" ? (
              <>
                Ironbrij-category work and work with no client, at raw tracked hours — never
                uplifted, since none of it is invoiced.
              </>
            ) : (
              <>
                Everything, with full cost and margin. Switch to Client-facing to produce something
                safe to send out.
              </>
            )}
          </p>
        </div>
      )}

      {(view === "detailed" || view === "casual") && entriesTruncated && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          This range has more than {DETAILED_ENTRIES_LIMIT.toLocaleString()} entries, so only the
          most recent ones are shown and the totals and export are incomplete. Narrow the date range
          to see everything.
        </p>
      )}

      {/* M46: Group by + category filter only apply to the Casual Service
          view, same reasoning the Detailed-only row above already
          establishes for keeping tab-specific filters off the shared row. */}
      {view === "profit" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Select value={profitGroupBy} onValueChange={(v) => setProfitGroupBy(v as ProfitGroupBy)}>
            <SelectTrigger className="w-48" aria-label="Group by">
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
              ? ` (Paid Casual work plus ${settings.clientBillingUpliftPct}%, rounded up)`
              : " (Paid Casual work rounded up)"}
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
            <SelectTrigger className="w-40" aria-label="Group by">
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
            <SelectTrigger className="w-48" aria-label="Filter by category">
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
        <ProjectReportView
          projAsc={projAsc}
          projSortKey={projSortKey}
          projectRows={projectRows}
          rangeLabel={rangeLabel}
          sortedProjects={sortedProjects}
          toggleProjSort={toggleProjSort}
        />
      ) : view === "employee" ? (
        <EmployeeReportView
          clientFilter={clientFilter}
          clients={clients}
          empAsc={empAsc}
          empSortKey={empSortKey}
          employeeRows={employeeRows}
          rangeLabel={rangeLabel}
          settings={settings}
          sortedEmployees={sortedEmployees}
          toggleEmpSort={toggleEmpSort}
        />
      ) : view === "detailed" ? (
        <DetailedReportView
          currentDetailedPage={currentDetailedPage}
          filteredDetailed={filteredDetailed}
          pagedDetailed={pagedDetailed}
          setDetailedPage={setDetailedPage}
          tags={tags}
          totalDetailedPages={totalDetailedPages}
        />
      ) : view === "casual" ? (
        <CasualReportView
          casualActiveClients={casualActiveClients}
          casualActiveVAs={casualActiveVAs}
          casualAriaSort={casualAriaSort}
          casualChartTickInterval={casualChartTickInterval}
          casualGrandTotals={casualGrandTotals}
          casualGroupBy={casualGroupBy}
          casualGroupChartData={casualGroupChartData}
          casualHasLastWeekData={casualHasLastWeekData}
          casualSortHeader={casualSortHeader}
          casualTotalBillableHours={casualTotalBillableHours}
          lastWeekCasualActiveClients={lastWeekCasualActiveClients}
          lastWeekCasualActiveVAs={lastWeekCasualActiveVAs}
          lastWeekCasualTotalBillableHours={lastWeekCasualTotalBillableHours}
          rangeLabel={rangeLabel}
          settings={settings}
          sortedCasualGroups={sortedCasualGroups}
          tags={tags}
        />
      ) : showClientFacing ? (
        /* M51: the client-facing view. A separate table fed by a separate
           projection, so there is no cost or margin value in scope here to
           be shown by accident. */
        <ClientFacingReportView
          clientFacingRows={clientFacingRows}
          clientFacingTotalHours={clientFacingTotalHours}
          currentClientFacingPage={currentClientFacingPage}
          pagedClientFacingRows={pagedClientFacingRows}
          profitTruncated={profitTruncated}
          rangeLabel={rangeLabel}
          setClientFacingPage={setClientFacingPage}
          settings={settings}
          totalClientFacingPages={totalClientFacingPages}
        />
      ) : (
        <ProfitReportView
          combinedTotals={combinedTotals}
          costCellLabel={costCellLabel}
          departmentRows={departmentRows}
          departmentTotals={departmentTotals}
          profitGrandTotals={profitGrandTotals}
          profitGroupBy={profitGroupBy}
          profitGroups={profitGroups}
          profitTruncated={profitTruncated}
          rangeLabel={rangeLabel}
          retainerRows={retainerRows}
          retainerTotals={retainerTotals}
          retainersApply={retainersApply}
          salariesApply={salariesApply}
          salaryTotals={salaryTotals}
          salaryWeeks={salaryWeeks}
          settings={settings}
        />
      )}
    </AppShell>
  );
}
