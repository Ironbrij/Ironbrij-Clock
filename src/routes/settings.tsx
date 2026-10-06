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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNextButton,
  PaginationPreviousButton,
} from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectList } from "@/components/multi-select-list";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import {
  filterMembersBySearchAndTeam,
  MemberSearchFilter,
} from "@/components/member-search-filter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { billableHoursForCasualEntry } from "@/lib/casual-billing";
import { currencies, timezones, useWorkspace, type Role } from "@/lib/workspace-store";
import { toast } from "sonner";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

const settingsTabs = ["profile", "notifications", "users", "admin"] as const;
type SettingsTab = (typeof settingsTabs)[number];

// The active tab lives in the URL (?tab=users) so a refresh keeps it and
// other pages can link straight to a tab — the Dashboard's pending-signups
// banner links to Users.
export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => ({
    tab: settingsTabs.includes(search.tab as SettingsTab) ? (search.tab as SettingsTab) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Settings — IronTrack" },
      {
        name: "description",
        content:
          "Manage your IronTrack profile, notification preferences and workspace-level admin settings.",
      },
      { property: "og:title", content: "Settings — IronTrack" },
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Users has no non-admin fallback content, so a non-admin following a
  // ?tab=users link lands on Profile instead of a blank panel.
  const tab: SettingsTab =
    search.tab === "users" && !isAdmin ? "profile" : (search.tab ?? "profile");
  const setTab = (value: string) =>
    void navigate({
      search: { tab: value === "profile" ? undefined : (value as SettingsTab) },
      replace: true,
    });

  return (
    <AppShell title="Settings" subtitle="Make IronTrack feel like yours.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          {/* M29: the one real, working notification — deliberately not
              folded into the mocked list below, so it doesn't read as
              equally fake. No opt-out yet; every eligible reviewer
              (admin, or a manager sharing a team) always gets this one. */}
          <Card className="mb-4 max-w-2xl shadow-card">
            <CardContent className="flex items-center justify-between gap-4 p-6">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  Timesheet submitted for your review
                  <Badge variant="secondary" className="text-[10px]">
                    Live
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  Reviewers get an email automatically when someone on their team submits a
                  timesheet — not yet a preference you can turn off.
                </p>
              </div>
            </CardContent>
          </Card>
          <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
            Coming soon — these preferences aren't saved yet, so changes here won't persist.
          </p>
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
                    <Switch defaultChecked={n.on} disabled aria-label={n.label} />
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
  const { currentUser, updateProfile, uploadAvatar } = useWorkspace();
  const [fullName, setFullName] = useState(currentUser.name);
  const [jobTitle, setJobTitle] = useState(currentUser.title);
  const [timezone, setTimezone] = useState(currentUser.timezone);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFullName(currentUser.name);
    setJobTitle(currentUser.title);
    setTimezone(currentUser.timezone);
  }, [currentUser]);

  // The avatar uploads immediately on pick, so only the three text/select
  // fields below can hold unsaved edits.
  const dirty =
    fullName !== currentUser.name ||
    jobTitle !== currentUser.title ||
    timezone !== currentUser.timezone;

  const pickAvatar = () => avatarInputRef.current?.click();

  const onAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always clear the input's own value, success or failure, so choosing
    // the exact same file again still fires a change event next time.
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    try {
      await uploadAvatar(file);
      toast.success("Avatar updated");
    } catch (error) {
      toast.error("Couldn't upload that", { description: (error as Error).message });
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <Card className="max-w-2xl shadow-card">
      <UnsavedChangesGuard when={dirty} />
      <CardContent className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={currentUser.avatarUrl ?? undefined} alt={currentUser.name} />
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">
              {currentUser.initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => void onAvatarSelected(e)}
            />
            <Button variant="outline" size="sm" disabled={uploadingAvatar} onClick={pickAvatar}>
              {uploadingAvatar ? "Uploading…" : "Change avatar"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">PNG or JPG, up to 2&nbsp;MB.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Job title</Label>
            <Input
              id="title"
              autoComplete="organization-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
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
            {saving ? "Saving…" : "Save changes"}
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
    removeUser,
    resendInvite,
    updateMemberRole,
    addMemberToTeam,
    removeMemberFromTeam,
  } = useWorkspace();
  // L25/L26-class fix: a single shared `busyId` string can only ever
  // represent one in-flight action at a time — starting a second action on
  // a different row (or a different action on the same row) overwrites it,
  // which re-enables the first action's button before its request has
  // actually resolved. A Set of independent keys (one per row+action) lets
  // any number of actions be in flight at once without stepping on each
  // other's disabled state.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const isBusy = (key: string) => busyKeys.has(key);
  const startBusy = (key: string) => setBusyKeys((prev) => new Set(prev).add(key));
  const endBusy = (key: string) =>
    setBusyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  const [membersPage, setMembersPage] = useState(1);
  const MEMBERS_PAGE_SIZE = 10;
  const [memberSearch, setMemberSearch] = useState("");
  const [memberTeamFilter, setMemberTeamFilter] = useState("all");
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
    role: Role;
    pending: boolean;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [removing, setRemoving] = useState(false);

  const pendingMembers = activeMembers.filter((m) => m.pending);
  const approvedMembers = activeMembers.filter((m) => !m.pending);
  // M39: filtered ahead of pagination, so a search match on page 2 doesn't
  // require flipping through pages to find it first.
  const filteredApprovedMembers = filterMembersBySearchAndTeam(
    approvedMembers,
    memberSearch,
    memberTeamFilter,
  );
  const membersTotalPages = Math.max(
    1,
    Math.ceil(filteredApprovedMembers.length / MEMBERS_PAGE_SIZE),
  );
  const membersCurrentPage = Math.min(membersPage, membersTotalPages);
  const pagedApprovedMembers = filteredApprovedMembers.slice(
    (membersCurrentPage - 1) * MEMBERS_PAGE_SIZE,
    membersCurrentPage * MEMBERS_PAGE_SIZE,
  );

  useEffect(() => {
    setMembersPage(1);
  }, [memberSearch, memberTeamFilter]);

  const teamName = (teamId: string) => teams.find((t) => t.id === teamId)?.name ?? "No team";

  const changeRole = (m: { id: string; name: string }, role: Role) => {
    const key = `role:${m.id}`;
    startBusy(key);
    void updateMemberRole(m.id, role)
      .then(() => toast.success(`${m.name} is now ${role === "Admin" ? "an" : "a"} ${role}`))
      .catch((e: Error) => toast.error("Couldn't update role", { description: e.message }))
      .finally(() => endBusy(key));
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeUser(removeTarget.id);
      toast.success(
        removeTarget.pending ? `${removeTarget.name} rejected` : `${removeTarget.name} removed`,
        {
          description: removeTarget.pending
            ? "They can no longer sign in. They'd need a fresh invite to try again."
            : "They can no longer sign in. Their past time entries and timesheets are unchanged.",
        },
      );
      setRemoveTarget(null);
      setConfirmText("");
    } catch (error) {
      toast.error(
        removeTarget.pending ? "Couldn't reject that signup" : "Couldn't remove that person",
        { description: (error as Error).message },
      );
    } finally {
      setRemoving(false);
    }
  };

  const RoleCell = ({ m }: { m: { id: string; name: string; role: Role } }) => {
    // Changing your own role — especially demoting yourself away from
    // Admin — is exactly the kind of one-click accident that can lock the
    // whole workspace out of admin functions. The database also refuses
    // to demote the last remaining admin, but self-service role changes
    // don't need to be a dropdown at all: an admin who wants to hand off
    // their role to someone else should promote that person first, not
    // demote themselves.
    if (m.id === currentUser.id) {
      return (
        <Badge
          variant={m.role === "Admin" ? "default" : "secondary"}
          title="You can't change your own role"
        >
          {m.role}
        </Badge>
      );
    }
    return (
      <Select
        value={m.role}
        onValueChange={(v) => changeRole(m, v as Role)}
        disabled={isBusy(`role:${m.id}`)}
      >
        <SelectTrigger className="h-8 w-28" aria-label={`Role for ${m.name}`}>
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
  };

  const TeamCell = ({ m }: { m: { id: string; name: string; teamIds: string[] } }) => {
    const toggleTeam = (teamId: string) => {
      const removing = m.teamIds.includes(teamId);
      const key = `team:${m.id}`;
      startBusy(key);
      void (removing ? removeMemberFromTeam(m.id, teamId) : addMemberToTeam(m.id, teamId))
        .then(() =>
          toast.success(
            removing
              ? `${m.name} removed from ${teamName(teamId)}`
              : `${m.name} added to ${teamName(teamId)}`,
          ),
        )
        .catch((e: Error) => toast.error("Couldn't update teams", { description: e.message }))
        .finally(() => endBusy(key));
    };

    const label =
      m.teamIds.length === 0
        ? "Unassigned"
        : m.teamIds.length === 1
          ? teamName(m.teamIds[0])
          : `${m.teamIds.length} teams`;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy(`team:${m.id}`)}
            className="h-8 min-w-[9rem] justify-start font-normal"
            aria-label={`Teams for ${m.name}: ${label}`}
          >
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <MultiSelectList
            options={teams.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
            selected={m.teamIds}
            onToggle={toggleTeam}
            height="h-52"
          />
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="grid max-w-4xl gap-6">
      <Card className="min-w-0 shadow-card">
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
                      <td className="px-3 py-2.5 font-medium">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={m.avatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-secondary text-xs" aria-hidden="true">
                              {m.initials}
                            </AvatarFallback>
                          </Avatar>
                          {m.name}
                        </div>
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
                          {m.id !== currentUser.id && (
                            <Button
                              size="sm"
                              disabled={isBusy(`approve:${m.id}`)}
                              onClick={() => {
                                const key = `approve:${m.id}`;
                                startBusy(key);
                                void approveMember(m.id)
                                  .then(() => toast.success(`${m.name} approved`))
                                  .catch((e: Error) =>
                                    toast.error("Approval failed", { description: e.message }),
                                  )
                                  .finally(() => endBusy(key));
                              }}
                            >
                              Approve
                            </Button>
                          )}
                          {m.email && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy(`resend:${m.id}`)}
                              onClick={() => {
                                const key = `resend:${m.id}`;
                                startBusy(key);
                                void resendInvite(m.email!)
                                  .then(() => toast.success(`Invite resent to ${m.email}`))
                                  .catch((e: Error) =>
                                    toast.error("Couldn't resend that", { description: e.message }),
                                  )
                                  .finally(() => endBusy(key));
                              }}
                            >
                              Resend invite
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() =>
                              setRemoveTarget({
                                id: m.id,
                                name: m.name,
                                role: m.role,
                                pending: true,
                              })
                            }
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

      <Card className="min-w-0 shadow-card">
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
            <>
              {approvedMembers.length > 8 && (
                <MemberSearchFilter
                  search={memberSearch}
                  onSearchChange={setMemberSearch}
                  teamFilter={memberTeamFilter}
                  onTeamFilterChange={setMemberTeamFilter}
                  teams={teams}
                  className="mb-4"
                />
              )}
              {filteredApprovedMembers.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No one matches that search.
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
                      {pagedApprovedMembers.map((m) => (
                        <tr key={m.id} className="hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2.5 font-medium">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarImage src={m.avatarUrl ?? undefined} alt="" />
                                <AvatarFallback className="bg-secondary text-xs" aria-hidden="true">
                                  {m.initials}
                                </AvatarFallback>
                              </Avatar>
                              {m.name}
                            </div>
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
                                  setRemoveTarget({
                                    id: m.id,
                                    name: m.name,
                                    role: m.role,
                                    pending: false,
                                  })
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
            </>
          )}
          {filteredApprovedMembers.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {filteredApprovedMembers.length}{" "}
                {filteredApprovedMembers.length === 1 ? "member" : "members"}
                {filteredApprovedMembers.length !== approvedMembers.length &&
                  ` of ${approvedMembers.length}`}
                {membersTotalPages > 1 && ` · page ${membersCurrentPage} of ${membersTotalPages}`}
              </p>
              {membersTotalPages > 1 && (
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPreviousButton
                        disabled={membersCurrentPage <= 1}
                        onClick={() =>
                          membersCurrentPage > 1 && setMembersPage(membersCurrentPage - 1)
                        }
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNextButton
                        disabled={membersCurrentPage >= membersTotalPages}
                        onClick={() =>
                          membersCurrentPage < membersTotalPages &&
                          setMembersPage(membersCurrentPage + 1)
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
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
            <AlertDialogTitle>
              {removeTarget?.pending ? "Reject" : "Remove"} {removeTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.pending
                ? "They won't be able to sign in — they'd need a fresh invite to try again. Nothing else in the workspace is affected."
                : "They'll immediately lose the ability to sign in — this can't be undone from here; they'd need a fresh invite to come back. Their past time entries, timesheets, and reports stay exactly as they are; nothing historical is deleted."}
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
              {removeTarget?.pending ? "Reject" : "Remove access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type AdminField = "weeklyHours" | "uplift" | "increment" | "inactiveDays";
/** Page order, so focus lands on the topmost invalid field. */
const adminFieldOrder: AdminField[] = ["weeklyHours", "uplift", "increment", "inactiveDays"];
const adminFieldIds: Record<AdminField, string> = {
  weeklyHours: "ws-hours",
  uplift: "ws-client-uplift",
  increment: "ws-casual-increment",
  inactiveDays: "ws-client-inactive-days",
};

function AdminTab() {
  const { settings, updateSettings } = useWorkspace();
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [weeklyHours, setWeeklyHours] = useState(String(settings.weeklyHours));
  const [currency, setCurrency] = useState(settings.currency);
  const [logo, setLogo] = useState<string | null>(settings.logoDataUrl);
  const [requireDescriptions, setRequireDescriptions] = useState(settings.requireDescriptions);
  const [allowManualEntry, setAllowManualEntry] = useState(settings.allowManualEntry);
  const [casualBillingIncrementHours, setCasualBillingIncrementHours] = useState(
    String(settings.casualBillingIncrementHours),
  );
  const [clientBillingUpliftPct, setClientBillingUpliftPct] = useState(
    String(settings.clientBillingUpliftPct),
  );
  const [clientInactiveThresholdDays, setClientInactiveThresholdDays] = useState(
    String(settings.clientInactiveThresholdDays),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  // M51: a worked example of the two settings interacting, since "uplift
  // then round" and "round then uplift" give different answers and the pair
  // of inputs on their own doesn't say which order applies. Falls back to
  // the stored values while either box is mid-edit or invalid, so the
  // example never renders as NaN.
  const upliftPreviewPct =
    Number(clientBillingUpliftPct) >= 0 ? clientBillingUpliftPct || "0" : "0";
  const upliftPreviewHours = (() => {
    const pct = Number(upliftPreviewPct);
    const increment = Number(casualBillingIncrementHours);
    if (Number.isNaN(pct) || Number.isNaN(increment) || increment <= 0) return "—";
    return `${billableHoursForCasualEntry({ seconds: 6.1 * 3600 }, "paid_casual", {
      incrementHours: increment,
      upliftPct: pct,
    }).toFixed(2)}h`;
  })();

  useEffect(() => {
    setCompanyName(settings.companyName);
    setTimezone(settings.timezone);
    setWeeklyHours(String(settings.weeklyHours));
    setCurrency(settings.currency);
    setLogo(settings.logoDataUrl);
    setRequireDescriptions(settings.requireDescriptions);
    setAllowManualEntry(settings.allowManualEntry);
    setCasualBillingIncrementHours(String(settings.casualBillingIncrementHours));
    setClientBillingUpliftPct(String(settings.clientBillingUpliftPct));
    setClientInactiveThresholdDays(String(settings.clientInactiveThresholdDays));
  }, [settings]);

  const onPickLogo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const dailyGoal = (Number(weeklyHours) || 0) / 5;

  const dirty =
    companyName !== settings.companyName ||
    timezone !== settings.timezone ||
    weeklyHours !== String(settings.weeklyHours) ||
    currency !== settings.currency ||
    logo !== settings.logoDataUrl ||
    requireDescriptions !== settings.requireDescriptions ||
    allowManualEntry !== settings.allowManualEntry ||
    casualBillingIncrementHours !== String(settings.casualBillingIncrementHours) ||
    clientBillingUpliftPct !== String(settings.clientBillingUpliftPct) ||
    clientInactiveThresholdDays !== String(settings.clientInactiveThresholdDays);

  // Inline validation: each error shows under its own field, is announced
  // via aria-describedby, and the first invalid field (in page order) gets
  // focus on Save. The min= attributes on the inputs are browser hints only
  // — nothing stops typing past them — so these checks are the real gate.
  const [errors, setErrors] = useState<Partial<Record<AdminField, string>>>({});
  const clearError = (field: AdminField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  const errorProps = (field: AdminField) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${adminFieldIds[field]}-error` : undefined,
  });
  const fieldError = (field: AdminField) =>
    errors[field] ? (
      <p id={`${adminFieldIds[field]}-error`} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  const save = () => {
    const parsedHours = Number(weeklyHours);
    const parsedIncrement = Number(casualBillingIncrementHours);
    const parsedUplift = Number(clientBillingUpliftPct);
    const parsedInactiveDays = Number(clientInactiveThresholdDays);

    // Number("0") || fallback used to silently discard 0 (and any other
    // invalid entry) and save the old value instead — hence explicit checks.
    const next: Partial<Record<AdminField, string>> = {};
    if (!weeklyHours.trim() || Number.isNaN(parsedHours) || parsedHours < 1) {
      next.weeklyHours = "Enter a number of 1 or more.";
    }
    if (!clientBillingUpliftPct.trim() || Number.isNaN(parsedUplift) || parsedUplift < 0) {
      next.uplift = "Enter a number of 0 or more. Use 0 to invoice actual hours.";
    }
    if (
      !casualBillingIncrementHours.trim() ||
      Number.isNaN(parsedIncrement) ||
      parsedIncrement <= 0
    ) {
      next.increment = "Enter a number greater than 0, e.g. 0.25.";
    }
    if (
      !clientInactiveThresholdDays.trim() ||
      Number.isNaN(parsedInactiveDays) ||
      parsedInactiveDays <= 0
    ) {
      next.inactiveDays = "Enter a number of days greater than 0.";
    }
    setErrors(next);
    const firstInvalid = adminFieldOrder.find((field) => next[field]);
    if (firstInvalid) {
      document.getElementById(adminFieldIds[firstInvalid])?.focus();
      return;
    }

    setSaving(true);
    void updateSettings({
      companyName: companyName.trim() || settings.companyName,
      timezone,
      weeklyHours: parsedHours,
      currency,
      logoDataUrl: logo,
      requireDescriptions,
      allowManualEntry,
      casualBillingIncrementHours: parsedIncrement,
      clientBillingUpliftPct: parsedUplift,
      clientInactiveThresholdDays: parsedInactiveDays,
    })
      .then(() =>
        toast.success("Workspace settings saved", {
          description: "Your changes are live across the workspace.",
        }),
      )
      .catch((error: Error) =>
        toast.error("Couldn't save settings", { description: error.message }),
      )
      .finally(() => setSaving(false));
  };

  return (
    <div className="grid max-w-2xl gap-6">
      <UnsavedChangesGuard when={dirty && !saving} />
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

          <div className="grid gap-2" role="group" aria-labelledby="company-logo-label">
            <Label id="company-logo-label">Company logo</Label>
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
                <p className="mt-2 text-xs text-muted-foreground">
                  PNG, JPG or SVG, up to 2&nbsp;MB.
                </p>
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
              onChange={(e) => {
                setWeeklyHours(e.target.value);
                clearError("weeklyHours");
              }}
              {...errorProps("weeklyHours")}
            />
            {fieldError("weeklyHours")}
            <p className="text-xs text-muted-foreground">
              Drives the daily goal on your Dashboard — currently{" "}
              <span className="font-medium text-foreground">
                {Math.floor(dailyGoal)}h {Math.round((dailyGoal % 1) * 60)}m
              </span>{" "}
              per day across a five-day week.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-client-uplift">Client billing uplift (%)</Label>
            <Input
              id="ws-client-uplift"
              type="number"
              step={1}
              min={0}
              value={clientBillingUpliftPct}
              onChange={(e) => {
                setClientBillingUpliftPct(e.target.value);
                clearError("uplift");
              }}
              className="max-w-32"
              {...errorProps("uplift")}
            />
            {fieldError("uplift")}
            <p className="text-xs text-muted-foreground">
              Added to Paid Casual Service hours before they're rounded up, and applied to what the
              client is invoiced — never to what the VA is paid, which always uses actual tracked
              time. Set to 0 to invoice actual hours. Same scope as the increment below.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-casual-increment">Casual service billing increment (hours)</Label>
            <Input
              id="ws-casual-increment"
              type="number"
              step={0.05}
              min={0.05}
              value={casualBillingIncrementHours}
              onChange={(e) => {
                setCasualBillingIncrementHours(e.target.value);
                clearError("increment");
              }}
              className="max-w-32"
              {...errorProps("increment")}
            />
            {fieldError("increment")}
            <p className="text-xs text-muted-foreground">
              Paid Casual Service hours are rounded up to the nearest increment of this many hours
              in Reports and CSV exports. VIP Client, Promotional, Ironbrij and ordinary client work
              are all invoiced at exact tracked hours instead. Doesn't change any stored tracked
              time.
            </p>
            <p className="text-xs text-muted-foreground">
              Applied <span className="font-medium">after</span> the uplift — at {upliftPreviewPct}%
              and a {casualBillingIncrementHours || "0.25"}h increment, 6.10 tracked hours are
              invoiced as {upliftPreviewHours}.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ws-client-inactive-days">
              Casual service inactivity threshold (days)
            </Label>
            <Input
              id="ws-client-inactive-days"
              type="number"
              step={1}
              min={1}
              value={clientInactiveThresholdDays}
              onChange={(e) => {
                setClientInactiveThresholdDays(e.target.value);
                clearError("inactiveDays");
              }}
              className="max-w-32"
              {...errorProps("inactiveDays")}
            />
            {fieldError("inactiveDays")}
            <p className="text-xs text-muted-foreground">
              A client is flagged “Casual service inactive” on Projects and Clients once this many
              days have passed since their last casual-service entry.
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
              <Switch
                checked={requireDescriptions}
                onCheckedChange={setRequireDescriptions}
                aria-label="Require descriptions on entries"
              />
            </li>
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Allow manual time entry</p>
                <p className="text-xs text-muted-foreground">
                  Staff can add time without running the timer. Turn off to require the live timer
                  only.
                </p>
              </div>
              <Switch
                checked={allowManualEntry}
                onCheckedChange={setAllowManualEntry}
                aria-label="Allow manual time entry"
              />
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
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save workspace settings"}
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
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

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
      setRemoveTarget(null);
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
                  aria-label={`Rename ${t.name}`}
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
                  onClick={() => setRemoveTarget({ id: t.id, name: t.name })}
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
            aria-label="New task category name"
            autoComplete="off"
            placeholder="New category name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <Button disabled={adding || !newName.trim()} onClick={() => void add()}>
            Add
          </Button>
        </div>
      </CardContent>
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops appearing as a choice when logging time, and every project scoped to it loses
              it — a project scoped to only this category goes back to offering all of them. Entries
              already logged against it keep it. Re-adding the same name later won't restore those
              project scopes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingId !== null}
              onClick={(e) => {
                // Keep the dialog open until the delete resolves.
                e.preventDefault();
                if (removeTarget) void remove(removeTarget.id);
              }}
            >
              Remove category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
