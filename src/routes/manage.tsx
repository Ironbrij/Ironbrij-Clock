import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/combobox";
import { EntryFormDialog } from "@/components/entry-form-dialog";
import { Input } from "@/components/ui/input";
import {
  filterMembersBySearchAndTeam,
  MemberSearchFilter,
} from "@/components/member-search-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatHours, formatMinutes } from "@/lib/mock-data";
import {
  addDays,
  composeWeeklySchedule,
  convertTimeRange,
  formatClock,
  formatDayLong,
  formatWeekRange,
  fromDateKey,
  listTimezones,
  parseWeeklySchedule,
  startOfWeek,
  toDateKey,
  WEEKDAY_ABBR,
} from "@/lib/time-utils";
import {
  useActiveTimers,
  useMemberEntries,
  useThisWeekStart,
  useWorkspace,
  type ActiveTimer,
  type EmploymentType,
  type PendingApproval,
  type WorkspaceActivityEvent,
  type WorkspaceEmployment,
  type WorkspaceEntry,
} from "@/lib/workspace-store";

// M37: lets other pages/actions deep-link straight into a specific tab
// (and, for Entries, a specific person/week) instead of only ever landing
// on the default Schedule tab — used by the Dashboard's pending-approvals
// banner and by "Edit entries" inside Approvals.
type ManageSearch = { tab?: string; memberId?: string; weekStart?: string };

export const Route = createFileRoute("/manage")({
  validateSearch: (search: Record<string, unknown>): ManageSearch => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    memberId: typeof search.memberId === "string" ? search.memberId : undefined,
    weekStart: typeof search.weekStart === "string" ? search.weekStart : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Manage — IronTrack" },
      {
        name: "description",
        content:
          "Workspace management hub: schedule, entries, approvals and activity for Ironbrij teams.",
      },
      { property: "og:title", content: "Manage — IronTrack" },
      {
        property: "og:description",
        content: "Schedule, entries, approvals and activity in one hub.",
      },
    ],
  }),
  component: ManagePage,
});

const sections: { id: string; label: string }[] = [
  { id: "schedule", label: "Schedule" },
  { id: "entries", label: "Entries" },
  { id: "approvals", label: "Approvals" },
  { id: "activity", label: "Activity" },
];

function ManagePage() {
  const { unseenActivityCount, markActivitySeen } = useWorkspace();
  const search = Route.useSearch();
  const [tab, setTab] = useState(
    search.tab && sections.some((s) => s.id === search.tab) ? search.tab : sections[0].id,
  );
  const [entriesTarget, setEntriesTarget] = useState<
    { memberId: string; weekStart: string } | undefined
  >(
    search.memberId && search.weekStart
      ? { memberId: search.memberId, weekStart: search.weekStart }
      : undefined,
  );

  // Re-navigating to /manage with new search params (e.g. clicking "Edit
  // entries" from Approvals while already on /manage) doesn't remount this
  // component, so the deep-link has to be applied on search change too, not
  // just as the initial state above.
  useEffect(() => {
    if (!search.tab || !sections.some((s) => s.id === search.tab)) return;
    setTab(search.tab);
    if (search.tab === "activity") markActivitySeen();
    if (search.tab === "entries" && search.memberId && search.weekStart) {
      setEntriesTarget({ memberId: search.memberId, weekStart: search.weekStart });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.tab, search.memberId, search.weekStart]);

  const handleTabChange = (value: string) => {
    setTab(value);
    // A manual tab click means we're done with whatever deep-link brought
    // us here — otherwise clicking away from Entries and back would keep
    // reapplying a stale member/week from an earlier "Edit entries" click.
    setEntriesTarget(undefined);
    if (value === "activity") markActivitySeen();
  };

  return (
    <AppShell title="Manage" subtitle="Workspace operations, gathered in one hub.">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          {sections.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="relative">
              {s.label}
              {s.id === "activity" && unseenActivityCount > 0 && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "approvals" ? (
        <ApprovalsPanel />
      ) : tab === "activity" ? (
        <ActivityTab />
      ) : tab === "schedule" ? (
        <ScheduleTab />
      ) : tab === "entries" ? (
        <TeamEntriesTab
          // L38: keyed on the deep-link target so two consecutive "Edit
          // entries" links (browser back/forward, or a second pasted link)
          // force a remount and re-run the initialMemberId/initialWeekStart
          // useState initializer, instead of the second target being
          // silently ignored because the component never unmounted.
          key={`${entriesTarget?.memberId ?? ""}-${entriesTarget?.weekStart ?? ""}`}
          initialMemberId={entriesTarget?.memberId}
          initialWeekStart={entriesTarget?.weekStart}
        />
      ) : null}
    </AppShell>
  );
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Approved":
      return "default";
    case "Submitted":
      return "secondary";
    case "Rejected":
      return "destructive";
    default:
      return "outline";
  }
}

function WeekStatusPanel() {
  const { activeMembers, currentUser, isAdmin, teams, timesheets, employeeHoursForRange } =
    useWorkspace();
  const weekStart = useThisWeekStart();
  const weekKey = toDateKey(weekStart);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");

  const relevantMembers = useMemo(() => {
    const base = activeMembers.filter((m) => !m.pending && m.id !== currentUser.id);
    return isAdmin
      ? base
      : base.filter((m) => m.teamIds.some((tid) => currentUser.teamIds.includes(tid)));
  }, [activeMembers, currentUser, isAdmin]);

  const statusFor = useCallback(
    (userId: string) =>
      timesheets.find((t) => t.userId === userId && t.weekStart === weekKey)?.status ??
      "Not submitted",
    [timesheets, weekKey],
  );

  // L35: how much each person has actually logged this week, not just
  // whether they've submitted — someone can be on-track with real hours
  // and simply not have clicked Submit yet. A quiet failure here (e.g. a
  // dropped connection) just leaves hours blank; the status list itself,
  // which is the more important half of this panel, still works.
  const [hoursByUser, setHoursByUser] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let cancelled = false;
    employeeHoursForRange(weekKey, toDateKey(addDays(weekStart, 6)))
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        rows.forEach((r) => {
          map[r.userId] = r.minutes;
        });
        setHoursByUser(map);
      })
      .catch(() => {
        if (!cancelled) setHoursByUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [weekKey, weekStart, employeeHoursForRange]);

  const filteredMembers = useMemo(
    () => filterMembersBySearchAndTeam(relevantMembers, search, teamFilter),
    [relevantMembers, search, teamFilter],
  );

  const sorted = useMemo(() => {
    const rank: Record<string, number> = {
      "Not submitted": 0,
      Rejected: 1,
      Draft: 1,
      Submitted: 2,
      Approved: 3,
    };
    return [...filteredMembers].sort((a, b) => {
      const diff = (rank[statusFor(a.id)] ?? 0) - (rank[statusFor(b.id)] ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [filteredMembers, statusFor]);

  if (relevantMembers.length === 0) return null;

  return (
    <Card className="mb-4 shadow-card">
      <CardContent className="p-0">
        <div className="border-b border-border px-6 py-3">
          <h3 className="text-sm font-semibold">This week · {formatWeekRange(weekStart)}</h3>
          <p className="text-xs text-muted-foreground">
            Who's submitted their timesheet so far — not just what's waiting on you.
          </p>
        </div>
        {relevantMembers.length > 8 && (
          <div className="border-b border-border px-6 py-3">
            <MemberSearchFilter
              search={search}
              onSearchChange={setSearch}
              teamFilter={teamFilter}
              onTeamFilterChange={setTeamFilter}
              teams={teams}
            />
          </div>
        )}
        {sorted.length === 0 && (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No one matches that search.
          </p>
        )}
        <ul className="divide-y divide-border">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-6 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-secondary text-xs">{m.initials}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">{m.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {hoursByUser && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatHours((hoursByUser[m.id] ?? 0) / 60)}
                  </span>
                )}
                <Badge variant={statusBadgeVariant(statusFor(m.id))}>{statusFor(m.id)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ApprovalsPanel() {
  const { pendingApprovals, memberById, reviewTimesheet } = useWorkspace();
  // L26: a single shared busyId string could only ever represent one row
  // in flight at a time — approving row A, then acting on row B before A's
  // request resolved, overwrote busyId to B and re-enabled A's buttons
  // early (its `finally` cleared busyId unconditionally). A Set of ids
  // lets any number of rows be in flight independently.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const startBusy = (id: string) => setBusyIds((prev) => new Set(prev).add(id));
  const endBusy = (id: string) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  // Approve has no "unapprove" at all — review_timesheet() only ever
  // transitions a row that's currently 'submitted', with no exception for
  // admins on an already-approved one — unlike Send back, which already
  // asked for confirmation via a dialog. Approve used to fire on a single
  // click with no confirmation, the inverse of its actual risk.
  const [approving, setApproving] = useState<PendingApproval | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // M31: bulk-approve. Selection is separate from busyIds so a row can be
  // selected while idle and only becomes "busy" once a batch is actually
  // running. Deliberately still per-timesheet reviewTimesheet() calls in a
  // loop, not a new bulk RPC — approving is irreversible (see the note
  // above), so the confirmation dialog below names every person/week being
  // approved rather than collapsing to a count, keeping a bulk click as
  // informed as clicking Approve N times individually.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);

  const approve = async () => {
    if (!approving) return;
    const id = approving.id;
    setApproving(null);
    startBusy(id);
    try {
      await reviewTimesheet(id, "Approved");
      toast.success("Timesheet approved", { description: "That week is now locked for editing." });
    } catch (error) {
      toast.error("Couldn't approve that", { description: (error as Error).message });
    } finally {
      endBusy(id);
    }
  };

  const bulkApprove = async () => {
    const targets = pendingApprovals.filter((a) => selectedIds.has(a.id));
    setConfirmingBulk(false);
    setBulkApproving(true);
    targets.forEach((a) => startBusy(a.id));
    let succeeded = 0;
    let failed = 0;
    for (const a of targets) {
      try {
        await reviewTimesheet(a.id, "Approved");
        succeeded++;
      } catch {
        failed++;
      } finally {
        endBusy(a.id);
      }
    }
    setBulkApproving(false);
    setSelectedIds(new Set());
    if (succeeded > 0) {
      toast.success(`Approved ${succeeded} ${succeeded === 1 ? "timesheet" : "timesheets"}`, {
        description:
          failed > 0
            ? `${failed} couldn't be approved — try ${failed === 1 ? "it" : "them"} individually to see why.`
            : "Those weeks are now locked for editing.",
      });
    } else if (failed > 0) {
      toast.error("Couldn't approve those", {
        description: "Try them individually to see what went wrong.",
      });
    }
  };

  const reject = async (note: string) => {
    if (!rejecting) return;
    const id = rejecting.id;
    setRejecting(null);
    startBusy(id);
    try {
      await reviewTimesheet(id, "Rejected", note || undefined);
      toast.success("Sent back", { description: "They'll see your note on their Timesheet page." });
    } catch (error) {
      toast.error("Couldn't send that back", { description: (error as Error).message });
    } finally {
      endBusy(id);
    }
  };

  if (pendingApprovals.length === 0) {
    return (
      <div className="mt-4">
        <WeekStatusPanel />
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <CheckCheck className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">All caught up</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Nothing's waiting on your review right now.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allSelected =
    pendingApprovals.length > 0 && pendingApprovals.every((a) => selectedIds.has(a.id));
  const selectedApprovals = pendingApprovals.filter((a) => selectedIds.has(a.id));
  const selectedTotalMinutes = selectedApprovals.reduce((sum, a) => sum + a.minutes, 0);

  return (
    <div className="mt-4">
      <WeekStatusPanel />
      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelectedIds(checked ? new Set(pendingApprovals.map((a) => a.id)) : new Set())
                }
                aria-label="Select all pending timesheets"
              />
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
            </label>
            <Button
              size="sm"
              disabled={selectedIds.size === 0 || bulkApproving}
              onClick={() => setConfirmingBulk(true)}
            >
              Approve selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {pendingApprovals.map((a) => {
              const member = memberById(a.userId);
              const expanded = expandedId === a.id;
              return (
                <li key={a.id}>
                  <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={selectedIds.has(a.id)}
                        disabled={busyIds.has(a.id)}
                        onCheckedChange={(checked) =>
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(a.id);
                            else next.delete(a.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${member?.name ?? "this timesheet"} for bulk approval`}
                      />
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-secondary text-xs">
                          {member?.initials ?? "—"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{member?.name ?? "Unknown"}</p>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setExpandedId(expanded ? null : a.id)}
                        >
                          {formatWeekRange(fromDateKey(a.weekStart))} ·{" "}
                          {formatHours(a.minutes / 60)} logged
                          <ChevronDown
                            className={
                              "h-3 w-3 transition-transform " + (expanded ? "rotate-180" : "")
                            }
                          />
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/manage"
                          search={{ tab: "entries", memberId: a.userId, weekStart: a.weekStart }}
                        >
                          Edit entries
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyIds.has(a.id)}
                        onClick={() => setRejecting(a)}
                      >
                        Send back
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyIds.has(a.id)}
                        onClick={() => setApproving(a)}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                  {expanded && <ApprovalEntries approval={a} />}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <RejectDialog
        approval={rejecting}
        onOpenChange={(open) => !open && setRejecting(null)}
        onConfirm={reject}
      />
      <AlertDialog open={!!approving} onOpenChange={(open) => !open && setApproving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this timesheet?</AlertDialogTitle>
            <AlertDialogDescription>
              {approving
                ? `${memberById(approving.userId)?.name ?? "This person"}'s week of ${formatWeekRange(
                    fromDateKey(approving.weekStart),
                  )} (${formatHours(approving.minutes / 60)}) will be locked for editing. This can't be undone — there's no way to un-approve a timesheet once it's approved.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void approve()}>Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmingBulk} onOpenChange={setConfirmingBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {selectedApprovals.length}{" "}
              {selectedApprovals.length === 1 ? "timesheet" : "timesheets"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {formatHours(selectedTotalMinutes / 60)} total will be locked for editing. This
                  can't be undone for any of them — there's no way to un-approve a timesheet once
                  it's approved.
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs">
                  {selectedApprovals.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span className="truncate">
                        {memberById(a.userId)?.name ?? "Unknown"} ·{" "}
                        {formatWeekRange(fromDateKey(a.weekStart))}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatHours(a.minutes / 60)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void bulkApprove()}>
              Approve {selectedApprovals.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The entries behind one pending approval's total — expanded inline so a reviewer can check what they're actually approving instead of trusting a single number. */
function ApprovalEntries({ approval }: { approval: PendingApproval }) {
  const { entriesForApproval, projectById } = useWorkspace();
  const entries = entriesForApproval(approval);

  if (entries.length === 0) {
    return (
      <p className="border-t border-border bg-muted/30 px-6 py-4 text-xs text-muted-foreground">
        No individual entries found for this week.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border border-t border-border bg-muted/30 px-6">
      {entries.map((e) => {
        const project = projectById(e.projectId);
        return (
          <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
            <ProjectDot color={project?.color ?? "var(--muted-foreground)"} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{e.description || "No description"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {project?.name ?? "No project"} · {e.task || "—"} ·{" "}
                {formatDayLong(new Date(e.startTime))}, {formatClock(e.startTime)}
              </p>
            </div>
            <span className="shrink-0 tabular-nums text-xs font-medium">
              {formatMinutes(e.minutes)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function describeActivityEvent(
  e: WorkspaceActivityEvent,
  nameOf: (id: string | null) => string,
  teamName: (id: string) => string,
) {
  const actor = nameOf(e.actorId);
  const target = nameOf(e.targetUserId);
  const isSelf = !!e.actorId && e.actorId === e.targetUserId;
  const week = (key: unknown) =>
    typeof key === "string" ? formatWeekRange(fromDateKey(key)) : "an unknown week";

  switch (e.action) {
    case "member_approved":
      return `${actor} approved ${target}`;
    case "role_changed": {
      const oldRole = String(e.metadata.old_role ?? "").replace(/^\w/, (c) => c.toUpperCase());
      const newRole = String(e.metadata.new_role ?? "").replace(/^\w/, (c) => c.toUpperCase());
      return `${actor} changed ${target}'s role from ${oldRole || "—"} to ${newRole || "—"}`;
    }
    case "timesheet_submitted":
      return `${actor} submitted ${isSelf ? "their" : `${target}'s`} timesheet for ${week(e.metadata.week_start)}`;
    case "timesheet_approved":
      return `${actor} approved ${target}'s timesheet for ${week(e.metadata.week_start)}`;
    case "timesheet_rejected": {
      const note =
        typeof e.metadata.note === "string" && e.metadata.note ? ` — "${e.metadata.note}"` : "";
      return `${actor} sent back ${target}'s timesheet for ${week(e.metadata.week_start)}${note}`;
    }
    case "team_added": {
      const tid = typeof e.metadata.team_id === "string" ? e.metadata.team_id : "";
      return `${actor} added ${target} to ${teamName(tid)}`;
    }
    case "team_removed": {
      const tid = typeof e.metadata.team_id === "string" ? e.metadata.team_id : "";
      return `${actor} removed ${target} from ${teamName(tid)}`;
    }
    case "member_removed":
      return `${actor} removed ${target}'s access`;
    case "time_entry_edited": {
      const day =
        typeof e.metadata.entry_date === "string"
          ? formatDayLong(fromDateKey(e.metadata.entry_date))
          : "an entry";
      return `${actor} edited ${target}'s entry for ${day}`;
    }
    case "time_entry_deleted": {
      const day =
        typeof e.metadata.entry_date === "string"
          ? formatDayLong(fromDateKey(e.metadata.entry_date))
          : "an entry";
      const description =
        typeof e.metadata.description === "string" && e.metadata.description
          ? ` — "${e.metadata.description}"`
          : "";
      return `${actor} deleted ${target}'s entry for ${day}${description}`;
    }
    default:
      return `${actor} — ${e.action}`;
  }
}

// M40: humanized labels for the action filter — falls back to the raw
// action string for anything not listed here, so a future action type
// never disappears from the filter, it's just unstyled.
const actionFilterLabels: Record<string, string> = {
  member_approved: "Sign-up approved",
  role_changed: "Role changed",
  timesheet_submitted: "Timesheet submitted",
  timesheet_approved: "Timesheet approved",
  timesheet_rejected: "Timesheet sent back",
  team_added: "Added to team",
  team_removed: "Removed from team",
  member_removed: "Access removed",
  time_entry_edited: "Entry edited",
  time_entry_deleted: "Entry deleted",
};

function ActivityTab() {
  const { activityLog, memberById, teams } = useWorkspace();
  const [personFilter, setPersonFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");

  const nameOf = (id: string | null) => (id ? (memberById(id)?.name ?? "Someone") : "Someone");
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "a team";

  // M40: who to offer in the person filter — everyone who's actually
  // appeared as an actor or a target in the log, not the whole roster, so
  // someone who's since lost access but has historical events is still
  // findable.
  const peopleInLog = useMemo(() => {
    const ids = new Set<string>();
    for (const e of activityLog) {
      if (e.actorId) ids.add(e.actorId);
      if (e.targetUserId) ids.add(e.targetUserId);
    }
    return Array.from(ids)
      .map((id) => ({ id, name: nameOf(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityLog, memberById]);

  const actionsInLog = useMemo(
    () => Array.from(new Set(activityLog.map((e) => e.action))).sort(),
    [activityLog],
  );

  const filteredLog = useMemo(
    () =>
      activityLog
        .filter(
          (e) =>
            personFilter === "all" || e.actorId === personFilter || e.targetUserId === personFilter,
        )
        .filter((e) => actionFilter === "all" || e.action === actionFilter),
    [activityLog, personFilter, actionFilter],
  );

  const weeks = useMemo(() => {
    const groups = new Map<string, WorkspaceActivityEvent[]>();
    for (const e of filteredLog) {
      const key = toDateKey(startOfWeek(new Date(e.createdAt)));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filteredLog]);

  if (activityLog.length === 0) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Activity className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Nothing logged yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Approvals, role changes, and team updates will show up here, grouped by week, as they
            happen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 grid gap-4">
      {(peopleInLog.length > 2 || actionsInLog.length > 1) && (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={personFilter} onValueChange={setPersonFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {peopleInLog.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actionsInLog.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionFilterLabels[a] ?? a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {weeks.length === 0 && (
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">No matches</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Nothing in the log matches that filter.
            </p>
          </CardContent>
        </Card>
      )}
      {weeks.map(([weekKey, events]) => (
        <Card key={weekKey} className="shadow-card">
          <CardContent className="p-0">
            <div className="border-b border-border px-6 py-3">
              <h3 className="text-sm font-semibold">{formatWeekRange(fromDateKey(weekKey))}</h3>
            </div>
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 px-6 py-3">
                  <p className="text-sm">{describeActivityEvent(e, nameOf, teamName)}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Philippines has a single national timezone with no DST, unlike Australia's — safe to hardcode as one of the two reference zones a schedule gets converted into. The other is the workspace's own default timezone (Settings > General), which defaults to Australia/Sydney. */
const PH_TIMEZONE = "Asia/Manila";

function ScheduleTab() {
  const {
    activeMembers,
    currentUser,
    isAdmin,
    canManage,
    settings,
    teams,
    employmentByUser,
    updateMemberEmployment,
    updateMemberTimezone,
  } = useWorkspace();
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");

  const relevantMembers = useMemo(() => {
    const base = activeMembers.filter((m) => !m.pending);
    return isAdmin
      ? base
      : base.filter(
          (m) =>
            m.id === currentUser.id || m.teamIds.some((tid) => currentUser.teamIds.includes(tid)),
        );
  }, [activeMembers, currentUser, isAdmin]);

  const filteredMembers = useMemo(
    () => filterMembersBySearchAndTeam(relevantMembers, search, teamFilter),
    [relevantMembers, search, teamFilter],
  );

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <CalendarClock className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Schedule, rate, and employment details are only visible to people who manage the
            workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4 shadow-card">
      {relevantMembers.length > 8 && (
        <CardContent className="border-b border-border pb-4 pt-4">
          <MemberSearchFilter
            search={search}
            onSearchChange={setSearch}
            teamFilter={teamFilter}
            onTeamFilterChange={setTeamFilter}
            teams={teams}
          />
        </CardContent>
      )}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Timezone</th>
                <th className="px-4 py-2.5">Weekly schedule</th>
                <th className="px-4 py-2.5">Hourly rate ({settings.currency})</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredMembers.map((m) => (
                <ScheduleRow
                  key={m.id}
                  member={m}
                  employment={employmentByUser.get(m.id)}
                  updateMemberEmployment={updateMemberEmployment}
                  orgTimezone={settings.timezone}
                  isAdmin={isAdmin}
                  updateMemberTimezone={updateMemberTimezone}
                />
              ))}
              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No one to show here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Full IANA list, built once per module load rather than per row — it doesn't depend on props and Intl.supportedValuesOf/offset formatting isn't free at ~400 entries. */
const timezoneOptions = listTimezones();

function ScheduleRow({
  member,
  employment,
  updateMemberEmployment,
  orgTimezone,
  isAdmin,
  updateMemberTimezone,
}: {
  member: { id: string; name: string; initials: string; timezone: string };
  employment: WorkspaceEmployment | undefined;
  updateMemberEmployment: (
    userId: string,
    patch: {
      employmentType?: EmploymentType;
      hourlyRate?: number | null;
      weeklySchedule?: string | null;
    },
  ) => Promise<void>;
  orgTimezone: string;
  isAdmin: boolean;
  updateMemberTimezone: (memberId: string, timezone: string) => Promise<void>;
}) {
  const [schedule, setSchedule] = useState(() =>
    parseWeeklySchedule(employment?.weeklySchedule ?? ""),
  );
  const [rate, setRate] = useState(
    employment?.hourlyRate != null ? String(employment.hourlyRate) : "",
  );
  const [savingType, setSavingType] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    setSchedule(parseWeeklySchedule(employment?.weeklySchedule ?? ""));
    setRate(employment?.hourlyRate != null ? String(employment.hourlyRate) : "");
  }, [employment?.weeklySchedule, employment?.hourlyRate]);

  const employmentType = employment?.employmentType ?? "full_time";

  const saveType = async (type: EmploymentType) => {
    setSavingType(true);
    try {
      await updateMemberEmployment(member.id, { employmentType: type });
      toast.success(`${member.name} marked ${type === "full_time" ? "full-time" : "part-time"}`);
    } catch (error) {
      toast.error("Couldn't update that", { description: (error as Error).message });
    } finally {
      setSavingType(false);
    }
  };

  const savedSchedule = employment?.weeklySchedule ?? "";

  const saveSchedule = async (next: { days: boolean[]; start: string; end: string }) => {
    const composed = composeWeeklySchedule(next.days, next.start, next.end);
    if (composed === savedSchedule) return;
    setSavingSchedule(true);
    try {
      await updateMemberEmployment(member.id, { weeklySchedule: composed || null });
    } catch (error) {
      toast.error("Couldn't save schedule", { description: (error as Error).message });
      setSchedule(parseWeeklySchedule(savedSchedule));
    } finally {
      setSavingSchedule(false);
    }
  };

  const toggleDay = (index: number) => {
    const next = { ...schedule, days: schedule.days.map((d, i) => (i === index ? !d : d)) };
    setSchedule(next);
    void saveSchedule(next);
  };

  const setStart = (value: string) => setSchedule((prev) => ({ ...prev, start: value }));
  const setEnd = (value: string) => setSchedule((prev) => ({ ...prev, end: value }));
  const commitSchedule = () => void saveSchedule(schedule);

  const saveTimezone = async (timezone: string) => {
    setSavingTz(true);
    try {
      await updateMemberTimezone(member.id, timezone);
    } catch (error) {
      toast.error("Couldn't save timezone", { description: (error as Error).message });
    } finally {
      setSavingTz(false);
    }
  };

  const auSchedule = convertTimeRange(schedule.start, schedule.end, member.timezone, orgTimezone);
  const phSchedule = convertTimeRange(schedule.start, schedule.end, member.timezone, PH_TIMEZONE);
  // The parser found no recognizable weekday in whatever's currently saved
  // (a legacy hand-typed note, most likely) — flagged so an admin doesn't
  // mistake the all-unselected picker for "no schedule set" and silently
  // clobber it the moment they touch a day.
  const unrecognizedSchedule = savedSchedule && !schedule.days.some(Boolean);

  const saveRate = async () => {
    const original = employment?.hourlyRate != null ? String(employment.hourlyRate) : "";
    if (rate === original) return;
    const trimmed = rate.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && (parsed === null || Number.isNaN(parsed) || parsed < 0)) {
      toast.error("Rate must be a positive number");
      setRate(original);
      return;
    }
    try {
      await updateMemberEmployment(member.id, { hourlyRate: parsed });
    } catch (error) {
      toast.error("Couldn't save rate", { description: (error as Error).message });
      setRate(original);
    }
  };

  return (
    <tr className="transition-colors hover:bg-accent/40">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="bg-secondary text-xs">{member.initials}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{member.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Select
          value={employmentType}
          onValueChange={(v) => void saveType(v as EmploymentType)}
          disabled={savingType}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full_time">Full-time</SelectItem>
            <SelectItem value="part_time">Part-time</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <Combobox
            options={timezoneOptions}
            value={member.timezone}
            onChange={(tz) => void saveTimezone(tz)}
            disabled={savingTz}
            placeholder="Set timezone"
            searchPlaceholder="Search timezones…"
            triggerClassName="h-8 w-64 text-xs"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{member.timezone}</span>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex w-64 flex-col gap-1.5">
          <div className="flex gap-1">
            {WEEKDAY_ABBR.map((label, i) => (
              <button
                key={label}
                type="button"
                disabled={savingSchedule}
                onClick={() => toggleDay(i)}
                aria-pressed={schedule.days[i]}
                title={label}
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors " +
                  (schedule.days[i]
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent")
                }
              >
                {label[0]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="time"
              aria-label="Start time"
              value={schedule.start}
              onChange={(e) => setStart(e.target.value)}
              onBlur={commitSchedule}
              className="h-7 min-w-0 flex-1 pl-2 pr-1 text-xs"
            />
            <span className="shrink-0 text-xs text-muted-foreground">–</span>
            <Input
              type="time"
              aria-label="End time"
              value={schedule.end}
              onChange={(e) => setEnd(e.target.value)}
              onBlur={commitSchedule}
              className="h-7 min-w-0 flex-1 pl-2 pr-1 text-xs"
            />
          </div>
          {(auSchedule || phSchedule) && (
            <p className="truncate text-xs text-muted-foreground">
              {auSchedule && `AU ${auSchedule}`}
              {auSchedule && phSchedule && " · "}
              {phSchedule && `PH ${phSchedule}`}
            </p>
          )}
          {unrecognizedSchedule && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Couldn't read "{savedSchedule}" as days — pick above to replace it.
            </p>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => void saveRate()}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="0.00"
          className="h-8 w-28"
        />
      </td>
    </tr>
  );
}

/**
 * H11: a manager/admin viewing or editing an individual team member's time
 * entries — the RLS on time_entries already allowed this (admin on anyone,
 * manager on a shared-team member), there was just no UI for it. Reuses
 * updateEntry/deleteEntry from context as-is: neither is scoped to the
 * signed-in user client-side, they rely entirely on RLS, so they already
 * work correctly here. A manager (not admin) can't touch a locked
 * (submitted/approved) week — same as the backend — an admin still can.
 */
function TeamEntriesTab({
  initialMemberId,
  initialWeekStart,
}: {
  initialMemberId?: string;
  initialWeekStart?: string;
} = {}) {
  const {
    members,
    activeMembers,
    currentUser,
    isAdmin,
    canManage,
    teams,
    timesheets,
    projectById,
    deleteEntry,
  } = useWorkspace();
  const [memberId, setMemberId] = useState(initialMemberId ?? "");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberTeamFilter, setMemberTeamFilter] = useState("all");
  const thisWeek = useThisWeekStart();
  // M37: land on the deep-linked week (e.g. from Approvals' "Edit entries")
  // instead of always resetting to the current week.
  const [offset, setOffset] = useState(() =>
    initialWeekStart
      ? Math.round(
          (fromDateKey(initialWeekStart).getTime() - thisWeek.getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        )
      : 0,
  );
  const weekStart = useMemo(() => addDays(thisWeek, offset * 7), [thisWeek, offset]);

  const relevantMembers = useMemo(() => {
    const base = activeMembers.filter((m) => !m.pending && m.id !== currentUser.id);
    return isAdmin
      ? base
      : base.filter((m) => m.teamIds.some((tid) => currentUser.teamIds.includes(tid)));
  }, [activeMembers, currentUser, isAdmin]);

  // M20: the picker itself stays scoped to active members by default, but
  // a selection made by clicking a removed/deactivated person's row in the
  // Active Timers card below (see relevantActiveTimers) points at someone
  // who's since dropped out of relevantMembers entirely. Without this,
  // that leaves memberId set to an id the Select can't render — and
  // nothing in the UI can reach that person's entries (or their still-
  // running timer) at all, even though RLS already lets an admin see and
  // edit them. Appending them here, labeled, keeps that reachable.
  const selectableMembers = useMemo(() => {
    if (!memberId || relevantMembers.some((m) => m.id === memberId)) return relevantMembers;
    const extra = members.find((m) => m.id === memberId);
    return extra ? [...relevantMembers, extra] : relevantMembers;
  }, [relevantMembers, memberId, members]);

  // M39: narrows the picker's own option list rather than adding a
  // separate list to search — keeps the currently-selected person visible
  // even if they no longer match the filter, same as selectableMembers
  // already does for a since-deactivated selection above.
  const filteredSelectableMembers = useMemo(() => {
    const filtered = filterMembersBySearchAndTeam(
      selectableMembers,
      memberSearch,
      memberTeamFilter,
    );
    if (memberId && !filtered.some((m) => m.id === memberId)) {
      const current = selectableMembers.find((m) => m.id === memberId);
      if (current) return [current, ...filtered];
    }
    return filtered;
  }, [selectableMembers, memberSearch, memberTeamFilter, memberId]);

  useEffect(() => {
    if (memberId && members.some((m) => m.id === memberId)) return;
    setMemberId(relevantMembers[0]?.id ?? "");
  }, [relevantMembers, memberId, members]);

  const { entriesQ, entries } = useMemberEntries(memberId || null, weekStart);
  const weekKey = toDateKey(weekStart);
  const status = timesheets.find((t) => t.userId === memberId && t.weekStart === weekKey)?.status;
  const locked = (status === "Submitted" || status === "Approved") && !isAdmin;

  // M18/M20: passive visibility only — this doesn't stop anything, it
  // just lets a manager/admin notice a timer that's been running
  // suspiciously long, same as they'd notice from a person's own Time
  // page if they happened to be looking at it. Deliberately not filtered
  // through relevantMembers (active members only): a timer left running
  // by someone whose access was then removed is exactly the case this
  // needs to catch, and RLS has already scoped `activeTimers` to whoever
  // this viewer is allowed to see (everyone, for an admin; shared-team
  // members, for a manager) regardless of that person's active flag.
  const { activeTimers } = useActiveTimers();
  const relevantActiveTimers = useMemo(
    () => activeTimers.filter((t) => t.userId !== currentUser.id),
    [activeTimers, currentUser.id],
  );
  const selectMember = (id: string) => {
    setMemberId(id);
    setOffset(0);
  };

  const [editingEntry, setEditingEntry] = useState<WorkspaceEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<WorkspaceEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deletingEntry) return;
    setDeleting(true);
    try {
      await deleteEntry(deletingEntry.id);
      toast.success("Entry deleted");
      setDeletingEntry(null);
    } catch (error) {
      toast.error("Couldn't delete that", { description: (error as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Only people who manage the workspace can view or edit someone else's time entries.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (selectableMembers.length === 0) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">No one to show here yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {isAdmin ? "Invite some teammates first." : "No one on your teams to show here yet."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const weekTotal = entries.reduce((s, e) => s + e.minutes, 0) / 60;

  return (
    <div className="mt-4 grid gap-4">
      <ActiveTimersCard timers={relevantActiveTimers} onSelectMember={selectMember} />
      <Card className="shadow-card">
        {relevantMembers.length > 8 && (
          <CardContent className="border-b border-border pb-4 pt-4">
            <MemberSearchFilter
              search={memberSearch}
              onSearchChange={setMemberSearch}
              teamFilter={memberTeamFilter}
              onTeamFilterChange={setMemberTeamFilter}
              teams={teams}
              placeholder="Search team members…"
            />
          </CardContent>
        )}
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a team member" />
              </SelectTrigger>
              <SelectContent>
                {filteredSelectableMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {!m.active && " (inactive)"}
                  </SelectItem>
                ))}
                {filteredSelectableMembers.length === 0 && (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    No one matches that search.
                  </div>
                )}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => setOffset((o) => o - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9rem] text-center text-sm font-medium">
                {formatWeekRange(weekStart)}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={offset >= 0}
                onClick={() => setOffset((o) => Math.min(0, o + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {offset !== 0 && (
                <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
                  Today
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Total {formatHours(weekTotal)}</span>
            {status && <Badge variant={statusBadgeVariant(status)}>{status}</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {entriesQ.isLoading ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">Nothing logged this week.</p>
          ) : (
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
                          {p?.name ?? "No project"} · {entry.task || "—"} ·{" "}
                          {formatDayLong(fromDateKey(entry.date))}, {formatClock(entry.startTime)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="tabular-nums text-sm font-medium">
                        {entry.running ? "running" : formatMinutes(entry.minutes)}
                      </span>
                      {!entry.running &&
                        (locked ? (
                          <span
                            className="flex h-9 w-9 items-center justify-center text-muted-foreground"
                            title="This week is locked — only an admin can edit it"
                          >
                            <Lock className="h-4 w-4" />
                          </span>
                        ) : (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Edit entry"
                              onClick={() => setEditingEntry(entry)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Delete entry"
                              onClick={() => setDeletingEntry(entry)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <EntryFormDialog
        open={!!editingEntry}
        onOpenChange={(open) => !open && setEditingEntry(null)}
        entry={editingEntry}
      />

      <AlertDialog open={!!deletingEntry} onOpenChange={(open) => !open && setDeletingEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingEntry
                ? `"${deletingEntry.description || "No description"}" — ${formatMinutes(
                    deletingEntry.minutes,
                  )} on ${formatDayLong(fromDateKey(deletingEntry.date))}. This can't be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void confirmDelete()}>
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** How long a timer has to run before Manage > Entries flags it — matches the middle rung of the self-facing 4/8/12h warning in TimerBar. */
const ACTIVE_TIMER_FLAG_HOURS = 8;

/** M18: passive visibility into who currently has a timer running — not an action, just something a manager/admin can notice besides the forgetful person themselves. Renders nothing when there's nothing running. */
function ActiveTimersCard({
  timers,
  onSelectMember,
}: {
  timers: ActiveTimer[];
  onSelectMember: (userId: string) => void;
}) {
  const { memberById, projectById } = useWorkspace();

  if (timers.length === 0) return null;

  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        <div className="border-b border-border px-6 py-3">
          <h3 className="text-sm font-semibold">Active timers</h3>
          <p className="text-xs text-muted-foreground">
            Anyone on your teams with a timer currently running.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {timers.map((t) => {
            const member = memberById(t.userId);
            const project = projectById(t.projectId);
            const hoursRunning = (Date.now() - new Date(t.startTime).getTime()) / 3_600_000;
            const flagged = hoursRunning >= ACTIVE_TIMER_FLAG_HOURS;
            return (
              <li key={t.entryId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-6 py-2.5 text-left hover:bg-muted/40"
                  onClick={() => onSelectMember(t.userId)}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="bg-secondary text-xs">
                        {member?.initials ?? "—"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium">{member?.name ?? "Unknown"}</span>{" "}
                      <span className="text-muted-foreground">
                        · {project?.name ?? "No project"}
                      </span>
                    </span>
                  </span>
                  <span
                    className={
                      "flex shrink-0 items-center gap-1 text-xs tabular-nums " +
                      (flagged ? "font-medium text-destructive" : "text-muted-foreground")
                    }
                  >
                    {flagged && <AlertTriangle className="h-3.5 w-3.5" />}
                    running {hoursRunning < 1 ? "<1h" : `${Math.floor(hoursRunning)}h`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function RejectDialog({
  approval,
  onOpenChange,
  onConfirm,
}: {
  approval: PendingApproval | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (approval) setNote("");
  }, [approval]);

  return (
    <Dialog open={!!approval} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send this timesheet back?</DialogTitle>
          <DialogDescription>
            Let them know what needs fixing — this note shows up on their Timesheet page, and they
            can resubmit once it's sorted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reject-note">Note (optional)</Label>
          <Textarea
            id="reject-note"
            rows={3}
            placeholder="e.g. Wednesday's hours look off — can you double check?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(note.trim())}>
            Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
