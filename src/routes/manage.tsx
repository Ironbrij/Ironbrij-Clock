import { createFileRoute } from "@tanstack/react-router";
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
  FileText,
  Lock,
  MonitorSmartphone,
  Pencil,
  Receipt,
  Trash2,
  type LucideIcon,
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
import { EntryFormDialog } from "@/components/entry-form-dialog";
import { Input } from "@/components/ui/input";
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
  formatClock,
  formatDayLong,
  formatWeekRange,
  fromDateKey,
  startOfWeek,
  toDateKey,
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

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — IronTrack" },
      {
        name: "description",
        content:
          "Workspace management hub: schedule, entries, expenses, approvals, activity, kiosks and invoices for Ironbrij teams.",
      },
      { property: "og:title", content: "Manage — IronTrack" },
      {
        property: "og:description",
        content:
          "Schedule, entries, expenses, approvals, activity, kiosks and invoices in one hub.",
      },
    ],
  }),
  component: ManagePage,
});

const sections: { id: string; label: string; icon: LucideIcon; description: string }[] = [
  {
    id: "schedule",
    label: "Schedule",
    icon: CalendarClock,
    description: "Each person's weekly schedule, hourly rate, and employment type.",
  },
  {
    id: "entries",
    label: "Entries",
    icon: Clock,
    description: "View or edit an individual team member's time entries.",
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: Receipt,
    description: "Log project expenses alongside tracked hours — coming soon.",
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: CheckCheck,
    description: "Timesheets your team has submitted, waiting on your review.",
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    description: "Approvals, role changes, and team updates — grouped by week.",
  },
  {
    id: "kiosks",
    label: "Kiosks",
    icon: MonitorSmartphone,
    description: "Shared clock-in terminals for on-site teams — coming soon.",
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: FileText,
    description: "Turn billable hours into client invoices — scope still being confirmed.",
  },
];

function ManagePage() {
  const { unseenActivityCount, markActivitySeen } = useWorkspace();
  const [tab, setTab] = useState(sections[0].id);
  const active = sections.find((s) => s.id === tab)!;

  const handleTabChange = (value: string) => {
    setTab(value);
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
        <TeamEntriesTab />
      ) : (
        <Card className="mt-4 shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <active.icon className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">{active.label}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{active.description}</p>
          </CardContent>
        </Card>
      )}
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
  const { activeMembers, currentUser, isAdmin, timesheets } = useWorkspace();
  const weekStart = useThisWeekStart();
  const weekKey = toDateKey(weekStart);

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

  const sorted = useMemo(() => {
    const rank: Record<string, number> = {
      "Not submitted": 0,
      Rejected: 1,
      Draft: 1,
      Submitted: 2,
      Approved: 3,
    };
    return [...relevantMembers].sort((a, b) => {
      const diff = (rank[statusFor(a.id)] ?? 0) - (rank[statusFor(b.id)] ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }, [relevantMembers, statusFor]);

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
        <ul className="divide-y divide-border">
          {sorted.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-6 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-secondary text-xs">{m.initials}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">{m.name}</span>
              </div>
              <Badge variant={statusBadgeVariant(statusFor(m.id))} className="shrink-0">
                {statusFor(m.id)}
              </Badge>
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

  const allSelected = pendingApprovals.length > 0 && pendingApprovals.every((a) => selectedIds.has(a.id));
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

function ActivityTab() {
  const { activityLog, memberById, teams } = useWorkspace();

  const nameOf = (id: string | null) => (id ? (memberById(id)?.name ?? "Someone") : "Someone");
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "a team";

  const weeks = useMemo(() => {
    const groups = new Map<string, WorkspaceActivityEvent[]>();
    for (const e of activityLog) {
      const key = toDateKey(startOfWeek(new Date(e.createdAt)));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [activityLog]);

  if (weeks.length === 0) {
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

function ScheduleTab() {
  const {
    activeMembers,
    currentUser,
    isAdmin,
    canManage,
    settings,
    employmentByUser,
    updateMemberEmployment,
  } = useWorkspace();

  const relevantMembers = useMemo(() => {
    const base = activeMembers.filter((m) => !m.pending);
    return isAdmin
      ? base
      : base.filter(
          (m) =>
            m.id === currentUser.id || m.teamIds.some((tid) => currentUser.teamIds.includes(tid)),
        );
  }, [activeMembers, currentUser, isAdmin]);

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
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Weekly schedule</th>
                <th className="px-4 py-2.5">Hourly rate ({settings.currency})</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {relevantMembers.map((m) => (
                <ScheduleRow
                  key={m.id}
                  member={m}
                  employment={employmentByUser.get(m.id)}
                  updateMemberEmployment={updateMemberEmployment}
                />
              ))}
              {relevantMembers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
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

function ScheduleRow({
  member,
  employment,
  updateMemberEmployment,
}: {
  member: { id: string; name: string; initials: string };
  employment: WorkspaceEmployment | undefined;
  updateMemberEmployment: (
    userId: string,
    patch: {
      employmentType?: EmploymentType;
      hourlyRate?: number | null;
      weeklySchedule?: string | null;
    },
  ) => Promise<void>;
}) {
  const [schedule, setSchedule] = useState(employment?.weeklySchedule ?? "");
  const [rate, setRate] = useState(
    employment?.hourlyRate != null ? String(employment.hourlyRate) : "",
  );
  const [savingType, setSavingType] = useState(false);

  useEffect(() => {
    setSchedule(employment?.weeklySchedule ?? "");
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

  const saveSchedule = async () => {
    if (schedule === (employment?.weeklySchedule ?? "")) return;
    try {
      await updateMemberEmployment(member.id, { weeklySchedule: schedule.trim() || null });
    } catch (error) {
      toast.error("Couldn't save schedule", { description: (error as Error).message });
      setSchedule(employment?.weeklySchedule ?? "");
    }
  };

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
        <Input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          onBlur={() => void saveSchedule()}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="e.g. Mon–Fri, 9am–5pm"
          className="h-8 min-w-[220px]"
        />
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
function TeamEntriesTab() {
  const {
    members,
    activeMembers,
    currentUser,
    isAdmin,
    canManage,
    timesheets,
    projectById,
    deleteEntry,
  } = useWorkspace();
  const [memberId, setMemberId] = useState("");
  const thisWeek = useThisWeekStart();
  const [offset, setOffset] = useState(0);
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
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a team member" />
              </SelectTrigger>
              <SelectContent>
                {selectableMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {!m.active && " (inactive)"}
                  </SelectItem>
                ))}
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
