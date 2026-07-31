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
          <Card className="max-w-2xl shadow-card">
            <CardContent className="flex flex-col gap-6 p-6">
              <div className="grid gap-2">
                <Label htmlFor="workspace">Workspace name</Label>
                <Input id="workspace" defaultValue="Ironbrij / Virtual Assistant Australia" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="week-start">Week starts on</Label>
                <Select defaultValue="mon">
                  <SelectTrigger id="week-start"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mon">Monday</SelectItem>
                    <SelectItem value="sun">Sunday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hours">Standard working day (hours)</Label>
                <Input id="hours" type="number" defaultValue={7.5} step={0.5} />
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
                <Button>Save workspace settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}