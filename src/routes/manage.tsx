import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCheck,
  FileText,
  MonitorSmartphone,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatHours } from "@/lib/mock-data";
import { formatWeekRange, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import {
  useThisWeekStart,
  useWorkspace,
  type PendingApproval,
  type WorkspaceActivityEvent,
} from "@/lib/workspace-store";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — Ironbrij Time" },
      {
        name: "description",
        content:
          "Workspace management hub: schedule, expenses, approvals, activity, kiosks and invoices for Ironbrij teams.",
      },
      { property: "og:title", content: "Manage — Ironbrij Time" },
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
    description: "Plan shifts and capacity across teams — coming soon.",
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
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="bg-secondary text-xs">
                        {member?.initials ?? "—"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{member?.name ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatWeekRange(fromDateKey(a.weekStart))} · {formatHours(a.minutes / 60)}{" "}
                        logged
                      </p>
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
                    <Button size="sm" disabled={busyId === a.id} onClick={() => void approve(a.id)}>
                      Approve
                    </Button>
                  </div>
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
