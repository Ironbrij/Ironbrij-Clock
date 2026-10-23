import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, Download, History as HistoryIcon, Search } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Combobox } from "@/components/combobox";
import { CopyEodButton } from "@/components/copy-eod-button";
import { EntryList } from "@/components/entry-list";
import { downloadCsv } from "@/components/reports/report-config";
import { WorkBreakdownView } from "@/components/work-breakdown-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HISTORY_PRESETS,
  filterHistoryEntries,
  groupEntriesByDay,
  historyCsvRows,
  historyFloorKey,
  historyRangeForPreset,
  type HistoryPreset,
} from "@/lib/entry-history";
import { formatDuration, formatHours } from "@/lib/mock-data";
import {
  addDays,
  formatClock,
  formatDayLong,
  fromDateKey,
  startOfWeek,
  toDateKey,
} from "@/lib/time-utils";
import { buildWorkBreakdown } from "@/lib/work-breakdown";
import {
  MEMBER_HISTORY_LIMIT,
  OWN_ENTRIES_LIMIT,
  useMemberEntriesRange,
  useWorkspace,
  type WorkspaceEntry,
} from "@/lib/workspace-store";

type RangeChoice = HistoryPreset | "custom";
type HistoryView = "list" | "breakdown";

// Every filter lives in the URL so a refresh, or a link sent to someone,
// opens the same view. Defaults (the list, yourself, no filters, and the
// view's own default range) are left out of the URL.
type HistorySearch = {
  view?: "breakdown";
  range?: RangeChoice;
  from?: string;
  to?: string;
  q?: string;
  project?: string;
  client?: string;
  person?: string;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PRESET: HistoryPreset = "last-30";
/** The Breakdown answers "what did they do this week?", so it opens on this week. */
const BREAKDOWN_DEFAULT_PRESET: HistoryPreset = "this-week";
const ALL = "all";
/** Day cards rendered per "Show older days" step — and days added to the range once they're all showing. */
const DAYS_PER_STEP = 30;

export const Route = createFileRoute("/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch => {
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
    const date = (v: unknown) => (typeof v === "string" && DATE_KEY.test(v) ? v : undefined);
    const from = date(search.from);
    const to = date(search.to);
    const range: RangeChoice | undefined =
      search.range === "custom" && from && to
        ? "custom"
        : HISTORY_PRESETS.some((p) => p.id === search.range)
          ? (search.range as HistoryPreset)
          : undefined;
    return {
      view: search.view === "breakdown" ? "breakdown" : undefined,
      range,
      from: range === "custom" ? from : undefined,
      to: range === "custom" ? to : undefined,
      q: text(search.q),
      project: text(search.project),
      client: text(search.client),
      person: text(search.person),
    };
  },
  head: () => ({
    meta: [
      { title: "History — IronTrack" },
      {
        name: "description",
        content: "Every task you've timed: search, filter, scroll back and export your history.",
      },
      { property: "og:title", content: "History — IronTrack" },
      {
        property: "og:description",
        content: "Search, filter and export everything you've timed.",
      },
    ],
  }),
  component: HistoryPage,
});

function shortDate(key: string) {
  return fromDateKey(key).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dayTitle(key: string, today: Date) {
  const day = fromDateKey(key);
  const label = formatDayLong(day);
  if (key === toDateKey(today)) return `Today · ${label}`;
  return day.getFullYear() === today.getFullYear() ? label : `${label} ${day.getFullYear()}`;
}

function HistoryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const {
    entries: ownEntries,
    currentUser,
    canManage,
    isAdmin,
    activeMembers,
    projects,
    clients,
    projectById,
  } = useWorkspace();
  const update = (patch: Partial<HistorySearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  // The Breakdown is for admins and managers only. Anyone else who opens a
  // ?view=breakdown link just gets the list.
  const view: HistoryView = canManage && search.view === "breakdown" ? "breakdown" : "list";
  const defaultPreset = view === "breakdown" ? BREAKDOWN_DEFAULT_PRESET : DEFAULT_PRESET;

  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const floor = historyFloorKey(today);
  const rangeChoice: RangeChoice = search.range ?? defaultPreset;
  const { from, to } =
    rangeChoice === "custom" && search.from && search.to
      ? { from: search.from < floor ? floor : search.from, to: search.to }
      : historyRangeForPreset(rangeChoice === "custom" ? defaultPreset : rangeChoice, today);

  // Same people Manage > Entries offers: admins anyone active, managers
  // whoever shares a team with them. RLS enforces the same thing on the
  // fetch itself — this only decides what the picker lists.
  const otherPeople = useMemo(() => {
    if (!canManage) return [];
    const base = activeMembers.filter((m) => !m.pending && m.id !== currentUser.id);
    const visible = isAdmin
      ? base
      : base.filter((m) => m.teamIds.some((tid) => currentUser.teamIds.includes(tid)));
    return [...visible].sort((a, b) => a.name.localeCompare(b.name));
  }, [canManage, activeMembers, currentUser, isAdmin]);
  const person = otherPeople.find((m) => m.id === search.person) ?? null;

  const member = useMemberEntriesRange(person?.id ?? null, from, to);
  const source = person ? member.entries : ownEntries;
  const truncated = person ? member.truncated : ownEntries.length >= OWN_ENTRIES_LIMIT;

  const filtered = useMemo(
    () =>
      filterHistoryEntries(
        source,
        {
          from,
          to,
          search: search.q ?? "",
          projectId: search.project ?? null,
          clientId: search.client ?? null,
        },
        projectById,
      ),
    [source, from, to, search.q, search.project, search.client, projectById],
  );
  const days = useMemo(() => groupEntriesByDay(filtered), [filtered]);
  const totalSeconds = filtered.reduce((s, e) => s + e.seconds, 0);
  const breakdown = useMemo(
    () => (view === "breakdown" ? buildWorkBreakdown(filtered, projectById) : null),
    [view, filtered, projectById],
  );
  const runningInRange = filtered.some((e) => e.running);

  const [dayLimit, setDayLimit] = useState(DAYS_PER_STEP);
  const visibleDays = days.slice(0, dayLimit);
  const hiddenDays = days.length - visibleDays.length;
  const canGoFurther = from > floor;
  const showOlder = () => {
    setDayLimit((n) => n + DAYS_PER_STEP);
    if (hiddenDays > 0) return;
    const olderFrom = toDateKey(addDays(fromDateKey(from), -DAYS_PER_STEP));
    update({ range: "custom", from: olderFrom < floor ? floor : olderFrom, to });
  };

  const setRange = (value: string) => {
    if (value === "custom") update({ range: "custom", from, to });
    else
      update({
        range: value === defaultPreset ? undefined : (value as HistoryPreset),
        from: undefined,
        to: undefined,
      });
  };

  const projectOptions = useMemo(
    () => [
      { value: ALL, label: "All projects" },
      ...[...projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name })),
    ],
    [projects],
  );
  const clientOptions = useMemo(
    () => [
      { value: ALL, label: "All clients" },
      ...[...clients]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inactive)` })),
    ],
    [clients],
  );
  const personOptions = useMemo(
    () => [
      { value: currentUser.id, label: `Me (${currentUser.name})` },
      ...otherPeople.map((m) => ({ value: m.id, label: m.name })),
    ],
    [currentUser, otherPeople],
  );

  const exportCsv = () => {
    const who = (person?.name ?? currentUser.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadCsv(
      `ironbrij-history_${who}_${from}_to_${to}.csv`,
      historyCsvRows(filtered, projectById),
    );
  };

  const loadingMember = person !== null && member.entriesQ.isLoading;

  return (
    <AppShell
      title="History"
      subtitle="Everything you've timed — search it, scroll back through it, export it."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {otherPeople.length > 0 && (
            <Combobox
              aria-label="Whose history"
              options={personOptions}
              value={person?.id ?? currentUser.id}
              onChange={(id) => update({ person: id === currentUser.id ? undefined : id })}
              searchPlaceholder="Search people…"
              emptyText="No one matches that."
              className="w-64"
              triggerClassName="w-56"
            />
          )}
          {view === "list" && (
            <Button
              variant="outline"
              className="gap-2"
              disabled={filtered.length === 0}
              onClick={exportCsv}
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Export
            </Button>
          )}
        </div>
      }
    >
      {canManage && (
        <Tabs
          value={view}
          onValueChange={(v) => update({ view: v === "breakdown" ? "breakdown" : undefined })}
          className="mb-4"
        >
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <Card className="shadow-card">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label="Search history"
              autoComplete="off"
              placeholder="Search tasks, projects, clients…"
              value={search.q ?? ""}
              onChange={(e) => update({ q: e.target.value || undefined })}
              className="pl-8"
            />
          </div>
          <Combobox
            aria-label="Project"
            options={projectOptions}
            value={search.project ?? ALL}
            onChange={(v) => update({ project: v === ALL ? undefined : v })}
            searchPlaceholder="Search projects…"
          />
          <Combobox
            aria-label="Client"
            options={clientOptions}
            value={search.client ?? ALL}
            onChange={(v) => update({ client: v === ALL ? undefined : v })}
            searchPlaceholder="Search clients…"
          />
          <Select value={rangeChoice} onValueChange={setRange}>
            <SelectTrigger aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom range…</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
        {rangeChoice === "custom" && (
          <CardContent className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <Input
              type="date"
              aria-label="From date"
              className="w-40"
              min={floor}
              max={to}
              value={from}
              onChange={(e) =>
                e.target.value && update({ range: "custom", from: e.target.value, to })
              }
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="w-40"
              min={from}
              max={todayKey}
              value={to}
              onChange={(e) =>
                e.target.value && update({ range: "custom", from, to: e.target.value })
              }
            />
          </CardContent>
        )}
      </Card>

      <p className="mt-4 text-sm text-muted-foreground">
        {person ? `${person.name} · ` : ""}
        {filtered.length} {filtered.length === 1 ? "entry" : "entries"} ·{" "}
        {formatHours(totalSeconds / 3600)} · {shortDate(from)} – {shortDate(to)}
      </p>

      {truncated && (
        <Card className="mt-4 border-amber-500/40 shadow-card">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p>
              {person
                ? `This range has more than ${MEMBER_HISTORY_LIMIT.toLocaleString()} entries, so only the newest are shown and the oldest days are missing. Pick a shorter range to see them.`
                : `You have more than ${OWN_ENTRIES_LIMIT.toLocaleString()} entries in the last 13 months, so only the newest are loaded — the oldest days here may be incomplete.`}
            </p>
          </CardContent>
        </Card>
      )}

      {person && member.entriesQ.isError ? (
        <Card className="mt-4 shadow-card">
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            Couldn't load {person.name}'s entries — {(member.entriesQ.error as Error).message}
          </CardContent>
        </Card>
      ) : loadingMember ? (
        <Card className="mt-4 shadow-card">
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            Loading {person.name}'s entries…
          </CardContent>
        </Card>
      ) : days.length === 0 ? (
        <Card className="mt-4 shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <HistoryIcon className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {search.q || search.project || search.client
                ? "Nothing matches these filters in this date range."
                : "No time logged in this date range."}
            </p>
          </CardContent>
        </Card>
      ) : breakdown ? (
        <>
          {runningInRange && (
            <p className="mt-4 text-sm text-muted-foreground">
              A timer is still running, so its time isn't in the breakdown until it stops.
            </p>
          )}
          {breakdown.groups.length > 0 && (
            <WorkBreakdownView totalSeconds={breakdown.totalSeconds} groups={breakdown.groups} />
          )}
        </>
      ) : (
        <div className="mt-4 grid gap-6">
          {visibleDays.map((day) => (
            <Card key={day.date} className="shadow-card">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{dayTitle(day.date, today)}</CardTitle>
                <div className="flex items-center gap-2">
                  {person && (
                    <Button asChild variant="ghost" size="sm" className="text-xs">
                      <Link
                        to="/manage"
                        search={{
                          tab: "entries",
                          memberId: person.id,
                          weekStart: toDateKey(startOfWeek(fromDateKey(day.date))),
                        }}
                      >
                        Edit in Manage
                      </Link>
                    </Button>
                  )}
                  <CopyEodButton day={fromDateKey(day.date)} entries={day.entries} />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDuration(day.seconds)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {person ? (
                  <ReadOnlyEntryList entries={day.entries} />
                ) : (
                  <EntryList entries={day.entries} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {view === "list" && !loadingMember && (
        <div className="mt-6 flex justify-center">
          {hiddenDays > 0 || canGoFurther ? (
            <Button variant="outline" onClick={showOlder}>
              Show older days
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              That's as far back as IronTrack keeps (from {shortDate(floor)}).
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}

/** Someone else's entries: view only — managers edit them through Manage > Entries, which handles locked weeks for other people. */
function ReadOnlyEntryList({ entries }: { entries: WorkspaceEntry[] }) {
  const { projectById } = useWorkspace();
  return (
    <ul className="divide-y divide-border">
      {entries.map((entry) => {
        const p = projectById(entry.projectId);
        return (
          <li
            key={entry.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ProjectDot color={p?.color ?? "var(--muted-foreground)"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {entry.description || "No description"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {p?.name ?? "No project"} · {entry.task || "—"} · from{" "}
                  {formatClock(entry.startTime)}
                </p>
              </div>
            </div>
            <span className="tabular-nums text-sm font-medium">
              {entry.running ? "running" : formatDuration(entry.seconds)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
