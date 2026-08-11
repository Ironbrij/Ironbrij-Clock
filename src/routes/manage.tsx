import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  FileText,
  MonitorSmartphone,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  formatClock,
  formatDayLong,
  formatWeekRange,
  fromDateKey,
  startOfWeek,
  toDateKey,
} from "@/lib/time-utils";
import {
  useThisWeekStart,
  useWorkspace,
  type EmploymentType,
  type PendingApproval,
  type WorkspaceActivityEvent,
  type WorkspaceEmployment,
} from "@/lib/workspace-store";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — IronTrack" },
      {
        name: "description",
        content:
          "Workspace management hub: schedule, expenses, approvals, activity, kiosks and invoices for Ironbrij teams.",
      },
      { property: "og:title", content: "Manage — IronTrack" },
      {
        property: "og:description",
        content: "Schedule, expenses, approvals, activity, kiosks and invoices in one hub.",
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await reviewTimesheet(id, "Approved");
      toast.success("Timesheet approved", { description: "That week is now locked for editing." });
    } catch (error) {
      toast.error("Couldn't approve that", { description: (error as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (note: string) => {
    if (!rejecting) return;
    const id = rejecting.id;
    setRejecting(null);
    setBusyId(id);
    try {
      await reviewTimesheet(id, "Rejected", note || undefined);
      toast.success("Sent back", { description: "They'll see your note on their Timesheet page." });
    } catch (error) {
      toast.error("Couldn't send that back", { description: (error as Error).message });
    } finally {
      setBusyId(null);
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

  return (
    <div className="mt-4">
      <WeekStatusPanel />
      <Card className="shadow-card">
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {pendingApprovals.map((a) => {
              const member = memberById(a.userId);
              const expanded = expandedId === a.id;
              return (
                <li key={a.id}>
                  <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-secondary text-xs">
                          {member?.initials ?? "—"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member?.name ?? "Unknown"}
                        </p>
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
                        disabled={busyId === a.id}
                        onClick={() => setRejecting(a)}
                      >
                        Send back
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => void approve(a.id)}
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
