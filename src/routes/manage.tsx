import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { formatWeekRange, fromDateKey } from "@/lib/time-utils";
import { useWorkspace, type PendingApproval } from "@/lib/workspace-store";

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
    description: "A workspace audit and activity feed — coming soon.",
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
  const [tab, setTab] = useState(sections[0].id);
  const active = sections.find((s) => s.id === tab)!;

  return (
    <AppShell title="Manage" subtitle="Workspace operations, gathered in one hub.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {sections.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "approvals" ? (
        <ApprovalsPanel />
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
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <CheckCheck className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">All caught up</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Nothing's waiting on your review right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mt-4 shadow-card">
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
    </>
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
