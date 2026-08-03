import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencies, timezones, useWorkspace } from "@/lib/workspace-store";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ironbrij Time" },
      { name: "description", content: "Manage your Ironbrij Time profile, notification preferences and workspace-level admin settings." },
      { property: "og:title", content: "Settings — Ironbrij Time" },
      { property: "og:description", content: "Profile, notifications and workspace admin settings." },
    ],
  }),
  component: SettingsPage,
});

const notifications = [
  { label: "Daily reminder to log time", hint: "A gentle nudge at 5:00 pm if today looks empty.", on: true },
  { label: "Weekly timesheet summary", hint: "Monday morning recap of last week's hours.", on: true },
  { label: "Timer still running", hint: "We'll ping you if a timer runs past 4 hours.", on: true },
  { label: "Project assignments", hint: "When someone adds you to a project.", on: false },
  { label: "Report exports ready", hint: "When a large export finishes processing.", on: false },
];

function SettingsPage() {
  const { isAdmin } = useWorkspace();
  return (
    <AppShell title="Settings" subtitle="Make Ironbrij Time feel like yours.">
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card className="max-w-2xl shadow-card">
            <CardContent className="flex flex-col gap-6 p-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-primary text-lg text-primary-foreground">MA</AvatarFallback>
                </Avatar>
                <div>
                  <Button variant="outline" size="sm">Change avatar</Button>
                  <p className="mt-2 text-xs text-muted-foreground">PNG or JPG, up to 2 MB.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" defaultValue="Maya Alvarez" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="title">Job title</Label>
                  <Input id="title" defaultValue="Head of Delivery" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="work-email">Work email</Label>
                <Input id="work-email" type="email" defaultValue="maya@ironbrij.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tz">Timezone</Label>
                <Select defaultValue="syd">
                  <SelectTrigger id="tz"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="syd">Australia/Sydney (AEST)</SelectItem>
                    <SelectItem value="mnl">Asia/Manila (PHT)</SelectItem>
                    <SelectItem value="per">Australia/Perth (AWST)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Button>Save changes</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card className="max-w-2xl shadow-card">
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li key={n.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{n.label}</p>
                      <p className="text-xs text-muted-foreground">{n.hint}</p>
                    </div>
                    <Switch defaultChecked={n.on} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin" className="mt-6">
          {isAdmin ? <AdminTab /> : (
            <Card className="max-w-2xl shadow-card">
              <CardContent className="px-6 py-14 text-center">
                <p className="text-sm font-medium">Workspace settings are admin-only</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask an admin if something in here needs changing.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>
    </AppShell>
  );
}
function AdminTab() {
  const { settings, updateSettings } = useWorkspace();
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [weeklyHours, setWeeklyHours] = useState(String(settings.weeklyHours));
  const [currency, setCurrency] = useState(settings.currency);
  const [logo, setLogo] = useState<string | null>(settings.logoDataUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setTimezone(settings.timezone);
    setWeeklyHours(String(settings.weeklyHours));
    setCurrency(settings.currency);
    setLogo(settings.logoDataUrl);
  }, [settings]);

  const onPickLogo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const dailyGoal = (Number(weeklyHours) || 0) / 5;

  return (
    <div className="grid max-w-2xl gap-6">
      <Card className="shadow-card">
        <CardContent className="flex flex-col gap-6 p-6">
          <div className="grid gap-2">
            <Label htmlFor="company">Company name</Label>
            <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label>Company logo</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                {logo ? (
                  <img src={logo} alt="Workspace logo preview" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => onPickLogo(e.target.files?.[0])}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    Upload logo
                  </Button>
                  {logo && (
                    <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">PNG, JPG or SVG, up to 2 MB.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ws-tz">Default timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="ws-tz"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ws-currency">Default currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ws-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Used for billable rates in Reports and Invoices.</p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-hours">Standard working hours per week</Label>
            <Input
              id="ws-hours"
              type="number"
              step={0.5}
              min={1}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Drives the daily goal on your Dashboard — currently{" "}
              <span className="font-medium text-foreground">
                {Math.floor(dailyGoal)}h {Math.round((dailyGoal % 1) * 60)}m
              </span>{" "}
              per day across a five-day week.
            </p>
          </div>

          <ul className="divide-y divide-border rounded-xl border border-border">
            {[
              ["Require descriptions on entries", "Entries can't be saved without a short note.", true],
              ["Lock timesheets after approval", "Managers approve weekly; staff can't edit after.", false],
              ["Allow manual time entry", "Staff can add time without running the timer.", true],
            ].map(([label, hint, on]) => (
              <li key={label as string} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label as string}</p>
                  <p className="text-xs text-muted-foreground">{hint as string}</p>
                </div>
                <Switch defaultChecked={on as boolean} />
              </li>
            ))}
          </ul>

          <div>
            <Button
              onClick={() => {
                updateSettings({
                  companyName: companyName.trim() || settings.companyName,
                  timezone,
                  weeklyHours: Number(weeklyHours) || settings.weeklyHours,
                  currency,
                  logoDataUrl: logo,
                });
                toast.success("Workspace settings saved", {
                  description: "Your changes are live across the workspace.",
                });
              }}
            >
              Save workspace settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40 shadow-card">
        <CardContent className="flex flex-col gap-4 p-6">
          <div>
            <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Irreversible actions. We'll add safeguards before these go live.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete this workspace</p>
              <p className="text-xs text-muted-foreground">
                Permanently removes every project, timesheet and member. Not available yet.
              </p>
            </div>
            <Button variant="outline" disabled className="text-destructive">
              Delete workspace
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
