import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
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
import { currencies, timezones, useWorkspace, type Role } from "@/lib/workspace-store";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ironbrij Time" },
      {
        name: "description",
        content:
          "Manage your Ironbrij Time profile, notification preferences and workspace-level admin settings.",
      },
      { property: "og:title", content: "Settings — Ironbrij Time" },
      {
        property: "og:description",
        content: "Profile, notifications and workspace admin settings.",
      },
    ],
  }),
  component: SettingsPage,
});

const roles: Role[] = ["Admin", "Manager", "Member"];

const notifications = [
  {
    label: "Daily reminder to log time",
    hint: "A gentle nudge at 5:00 pm if today looks empty.",
    on: true,
  },
  {
    label: "Weekly timesheet summary",
    hint: "Monday morning recap of last week's hours.",
    on: true,
  },
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
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card className="max-w-2xl shadow-card">
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li
                    key={n.label}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-4"
                  >
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

        {isAdmin && (
          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
        )}

        <TabsContent value="admin" className="mt-6">
          {isAdmin ? (
            <AdminTab />
          ) : (
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

function ProfileTab() {
  const { currentUser, updateProfile } = useWorkspace();
  const [fullName, setFullName] = useState(currentUser.name);
  const [jobTitle, setJobTitle] = useState(currentUser.title);
  const [timezone, setTimezone] = useState(timezones[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(currentUser.name);
    setJobTitle(currentUser.title);
  }, [currentUser]);

  return (
    <Card className="max-w-2xl shadow-card">
      <CardContent className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">
              {currentUser.initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <Button variant="outline" size="sm">
              Change avatar
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">PNG or JPG, up to 2 MB.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Job title</Label>
            <Input id="title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="work-email">Work email</Label>
          <Input id="work-email" type="email" value={currentUser.email ?? ""} disabled />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tz">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="tz">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Button
            disabled={saving}
            onClick={() => {
              setSaving(true);
              updateProfile({ full_name: fullName.trim(), job_title: jobTitle.trim(), timezone })
                .then(() =>
                  toast.success("Profile saved", { description: "Your details are up to date." }),
                )
                .catch((error: Error) =>
                  toast.error("Couldn't save", { description: error.message }),
                )
                .finally(() => setSaving(false));
            }}
          >
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
function UsersTab() {
  const {
    activeMembers,
    teams,
    currentUser,
    approveMember,
    removeMember,
    removeUser,
    updateMemberRole,
    moveMember,
  } = useWorkspace();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; role: Role } | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState("");
  const [removing, setRemoving] = useState(false);

  const pendingMembers = activeMembers.filter((m) => m.pending);
  const approvedMembers = activeMembers.filter((m) => !m.pending);

  const teamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? "No team";

  const changeRole = (m: { id: string; name: string }, role: Role) => {
    setBusyId(m.id);
    void updateMemberRole(m.id, role)
      .then(() => toast.success(`${m.name} is now ${role === "Admin" ? "an" : "a"} ${role}`))
      .catch((e: Error) => toast.error("Couldn't update role", { description: e.message }))
      .finally(() => setBusyId(null));
  };

  const changeTeam = (m: { id: string; name: string }, teamId: string) => {
    setBusyId(m.id);
    void moveMember(m.id, teamId)
      .then(() => toast.success(`${m.name} moved to ${teamName(teamId)}`))
      .catch((e: Error) => toast.error("Couldn't move member", { description: e.message }))
      .finally(() => setBusyId(null));
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeUser(removeTarget.id);
      toast.success(`${removeTarget.name} removed`, {
        description:
          "They can no longer sign in. Their past time entries and timesheets are unchanged.",
      });
      setRemoveTarget(null);
      setConfirmText("");
    } catch (error) {
      toast.error("Couldn't remove that person", { description: (error as Error).message });
    } finally {
      setRemoving(false);
    }
  };

  const RoleCell = ({ m }: { m: { id: string; name: string; role: Role } }) => (
    <Select
      value={m.role}
      onValueChange={(v) => changeRole(m, v as Role)}
      disabled={busyId === m.id}
    >
      <SelectTrigger className="h-8 w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const TeamCell = ({ m }: { m: { id: string; name: string; teamId: string } }) => (
    <Select
      value={m.teamId || "unassigned"}
      onValueChange={(v) => changeTeam(m, v)}
      disabled={busyId === m.id}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!m.teamId && (
          <SelectItem value="unassigned" disabled>
            Unassigned
          </SelectItem>
        )}
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="grid max-w-4xl gap-6">
      <Card className="shadow-card">
        <CardContent className="p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Pending approval</h2>
            <p className="text-sm text-muted-foreground">
              People who've signed in but haven't been approved yet. They can see a waiting screen
              until you approve them.
            </p>
          </div>
          {pendingMembers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No one waiting — all signed-in users have been approved.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pendingMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-3 py-2.5 font-medium flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-secondary text-xs">
                            {m.initials}
                          </AvatarFallback>
                        </Avatar>
                        {m.name}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{m.email ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <RoleCell m={m} />
                      </td>
                      <td className="px-3 py-2.5">
                        <TeamCell m={m} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              void approveMember(m.id)
                                .then(() => toast.success(`${m.name} approved`))
                                .catch((e: Error) =>
                                  toast.error("Approval failed", { description: e.message }),
                                );
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => {
                              void removeMember(m.id)
                                .then(() => toast.success(`${m.name} removed`))
                                .catch((e: Error) =>
                                  toast.error("Remove failed", { description: e.message }),
                                );
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold">Approved members</h2>
            <p className="text-sm text-muted-foreground">
              Everyone with active access to the workspace.
            </p>
          </div>
          {approvedMembers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No approved members yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {approvedMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-3 py-2.5 font-medium flex items-center gap-2">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarFallback className="bg-secondary text-xs">
                            {m.initials}
                          </AvatarFallback>
                        </Avatar>
                        {m.name}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{m.email ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <RoleCell m={m} />
                      </td>
                      <td className="px-3 py-2.5">
                        <TeamCell m={m} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {m.id !== currentUser.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${m.name}`}
                            onClick={() =>
                              setRemoveTarget({ id: m.id, name: m.name, role: m.role })
                            }
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll immediately lose the ability to sign in — this can't be undone from here;
              they'd need a fresh invite to come back. Their past time entries, timesheets, and
              reports stay exactly as they are; nothing historical is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeTarget?.role === "Admin" && (
            <div className="grid gap-2">
              <Label
                htmlFor="confirm-remove-admin"
                className="text-sm font-medium text-destructive"
              >
                {removeTarget.name} is an admin. Type their name to confirm.
              </Label>
              <Input
                id="confirm-remove-admin"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={removeTarget.name}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                removing ||
                (removeTarget?.role === "Admin" &&
                  confirmText.trim().toLowerCase() !== removeTarget.name.trim().toLowerCase())
              }
              onClick={() => void confirmRemove()}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdminTab() {
  const { settings, updateSettings } = useWorkspace();
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [weeklyHours, setWeeklyHours] = useState(String(settings.weeklyHours));
  const [currency, setCurrency] = useState(settings.currency);
  const [logo, setLogo] = useState<string | null>(settings.logoDataUrl);
  const [requireDescriptions, setRequireDescriptions] = useState(settings.requireDescriptions);
  const [allowManualEntry, setAllowManualEntry] = useState(settings.allowManualEntry);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setTimezone(settings.timezone);
    setWeeklyHours(String(settings.weeklyHours));
    setCurrency(settings.currency);
    setLogo(settings.logoDataUrl);
    setRequireDescriptions(settings.requireDescriptions);
    setAllowManualEntry(settings.allowManualEntry);
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
            <Input
              id="company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Company logo</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                {logo ? (
                  <img
                    src={logo}
                    alt="Workspace logo preview"
                    className="h-full w-full object-contain"
                  />
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
                <SelectTrigger id="ws-tz">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ws-currency">Default currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ws-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for billable rates in Reports and Invoices.
              </p>
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
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Require descriptions on entries</p>
                <p className="text-xs text-muted-foreground">
                  Entries can't be saved without a short note.
                </p>
              </div>
              <Switch checked={requireDescriptions} onCheckedChange={setRequireDescriptions} />
            </li>
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Allow manual time entry</p>
                <p className="text-xs text-muted-foreground">
                  Staff can add time without running the timer. Turn off to require the live timer
                  only.
                </p>
              </div>
              <Switch checked={allowManualEntry} onCheckedChange={setAllowManualEntry} />
            </li>
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Lock timesheets after approval</p>
                <p className="text-xs text-muted-foreground">
                  Always on — once a manager approves a week, staff can't edit it. Admins can still
                  override if something needs correcting.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                Automatic
              </span>
            </li>
          </ul>

          <div>
            <Button
              onClick={() => {
                void updateSettings({
                  companyName: companyName.trim() || settings.companyName,
                  timezone,
                  weeklyHours: Number(weeklyHours) || settings.weeklyHours,
                  currency,
                  logoDataUrl: logo,
                  requireDescriptions,
                  allowManualEntry,
                })
                  .then(() =>
                    toast.success("Workspace settings saved", {
                      description: "Your changes are live across the workspace.",
                    }),
                  )
                  .catch((error: Error) =>
                    toast.error("Couldn't save settings", { description: error.message }),
                  );
              }}
            >
              Save workspace settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <TaskCategoriesCard />

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

function TaskCategoriesCard() {
  const { taskCategories, createTaskCategory, updateTaskCategory, deleteTaskCategory } =
    useWorkspace();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await createTaskCategory(name);
      setNewName("");
      toast.success("Task category added");
    } catch (error) {
      toast.error("Couldn't add that", { description: (error as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const saveEdit = async () => {
    const id = editingId;
    const original = taskCategories.find((t) => t.id === id)?.name ?? "";
    const name = editName.trim();
    setEditingId(null);
    if (!id || !name || name === original) return;
    try {
      await updateTaskCategory(id, name);
      toast.success("Task category renamed");
    } catch (error) {
      toast.error("Couldn't rename that", { description: (error as Error).message });
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteTaskCategory(id);
      toast.success("Task category removed");
    } catch (error) {
      toast.error("Couldn't remove that", { description: (error as Error).message });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="max-w-2xl shadow-card">
      <CardContent className="flex flex-col gap-4 p-6">
        <div>
          <h3 className="text-sm font-semibold">Task categories</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The options people pick from when logging time. Removing one doesn't touch entries
            already logged against it — it just stops appearing as a choice going forward.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {taskCategories.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
              {editingId === t.id ? (
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => void saveEdit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-8"
                />
              ) : (
                <span className="text-sm">{t.name}</span>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Rename ${t.name}`}
                  onClick={() => startEdit(t.id, t.name)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${t.name}`}
                  disabled={deletingId === t.id}
                  onClick={() => void remove(t.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
          {taskCategories.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No task categories yet — add one below.
            </li>
          )}
        </ul>
        <div className="flex gap-2">
          <Input
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <Button disabled={adding || !newName.trim()} onClick={() => void add()}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
