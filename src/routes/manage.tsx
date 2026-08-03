import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  CalendarClock,
  CheckCheck,
  FileText,
  MonitorSmartphone,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — Ironbrij Time" },
      {
        name: "description",
        content: "Workspace management hub: schedule, expenses, approvals, activity, kiosks and invoices for Ironbrij teams.",
      },
      { property: "og:title", content: "Manage — Ironbrij Time" },
      { property: "og:description", content: "Schedule, expenses, approvals, activity, kiosks and invoices in one hub." },
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
    description: "Review pending timesheet and time-off approvals — coming soon.",
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
            <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <active.icon className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">{active.label}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{active.description}</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}