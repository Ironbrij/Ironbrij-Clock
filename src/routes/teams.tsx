import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, MoreHorizontal, Pencil, Plus, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ColorDotPicker } from "@/components/color-dot-picker";
import { MultiSelectList } from "@/components/multi-select-list";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Role } from "@/lib/mock-data";
import { dotColors, useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/teams")({
  head: () => ({
    meta: [
      { title: "Teams — IronTrack" },
      {
        name: "description",
        content:
          "Ironbrij internal teams, their members and roles — invite people, create teams and manage rosters.",
      },
      { property: "og:title", content: "Teams — IronTrack" },
      {
        property: "og:description",
        content: "Internal Ironbrij teams, rosters and role management.",
      },
    ],
  }),
  component: TeamsPage,
});

const roles: Role[] = ["Admin", "Manager", "Member"];

function run(promise: Promise<unknown>, success: () => void) {
  promise
    .then(success)
    .catch((error: Error) => toast.error("That didn't save", { description: error.message }));
}

function TeamsPage() {
  const {
    teams,
    members,
    activeMembers,
    membersByTeam,
    teamMemberCount,
    projects,
    isAdmin,
    canManage,
    invitePeople,
    removeMemberFromTeam,
    createTeam,
    updateTeam,
    deleteTeam,
  } = useWorkspace();

  const [selected, setSelected] = useState(teams[0]?.id ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!teams.some((t) => t.id === selected)) setSelected(teams[0]?.id ?? "");
  }, [teams, selected]);

  const team = teams.find((t) => t.id === selected);
  const roster = team ? membersByTeam(team.id) : [];
  const editingTeam = teams.find((t) => t.id === editingTeamId) ?? null;
  const deletingTeam = teams.find((t) => t.id === deletingTeamId) ?? null;

  return (
    <AppShell
      title="Teams"
      subtitle={`${teams.length} teams, one workspace. Pick a team to see who's in it.`}
      actions={
        (isAdmin || canManage) && (
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="outline" className="gap-2" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" /> Invite people
              </Button>
            )}
            {canManage && (
              <Button
                className="gap-2"
                onClick={() => {
                  setEditingTeamId(null);
                  setTeamFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New team
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="shadow-card">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {teams.map((t) => {
                const preview = membersByTeam(t.id);
                return (
                  <li key={t.id} className="relative">
                    <button
                      onClick={() => setSelected(t.id)}
                      className={
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 " +
                        (selected === t.id ? "bg-accent/60" : "")
                      }
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-8 w-8 shrink-0 rounded-lg"
                          style={{
                            backgroundColor: `color-mix(in oklab, ${t.color} 22%, transparent)`,
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {teamMemberCount(t.id)} members
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="hidden -space-x-2 sm:flex">
                          {preview.slice(0, 3).map((m) => (
                            <Avatar key={m.id} className="h-7 w-7 border-2 border-card">
                              <AvatarImage src={m.avatarUrl ?? undefined} alt={m.name} />
                              <AvatarFallback className="bg-secondary text-[10px]">
                                {m.initials}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                        {canManage ? (
                          <span className="w-8" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                    {canManage && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Manage ${t.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditingTeamId(t.id);
                                setTeamFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" /> Edit team
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setDeletingTeamId(t.id)}
                            >
                              Delete team
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="h-fit shadow-card">
          <CardContent className="p-5">
            <h2 className="text-base font-semibold">{team?.name ?? "No teams yet"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {team ? `${teamMemberCount(team.id)} members` : "Create a team to get started."}
            </p>
            {team && roster.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No one's been added to this team yet — it's a quiet corner of the workspace for now.
              </p>
            ) : (
              <ul className="mt-5 space-y-3">
                {roster.map((m) => (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={m.avatarUrl ?? undefined} alt={m.name} />
                        <AvatarFallback className="bg-secondary text-xs">
                          {m.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-medium">
                          {m.name}
                          {m.pending && (
                            <Badge variant="outline" className="text-[10px] font-medium">
                              Pending
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email ?? m.title}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant={m.role === "Admin" ? "default" : "secondary"}>{m.role}</Badge>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Remove ${m.name} from ${team?.name ?? "this team"}`}
                          onClick={() => {
                            if (!team) return;
                            run(removeMemberFromTeam(m.id, team.id), () =>
                              toast.success(`${m.name} removed from ${team.name}`),
                            );
                          }}
                        >
                          <UserMinus className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        defaultTeamId={selected}
        onInvite={(payload) => {
          invitePeople(payload)
            .then((count) =>
              toast.success("Invite sent", {
                description: `${count} ${count === 1 ? "person" : "people"} invited as ${payload.role}.`,
              }),
            )
            .catch((error: Error) => toast.error("Invite failed", { description: error.message }));
        }}
      />

      <TeamFormDialog
        key={editingTeam?.id ?? "new-team"}
        open={teamFormOpen}
        onOpenChange={setTeamFormOpen}
        team={editingTeam}
        people={activeMembers}
        onSubmit={({ name, color, memberIds }) => {
          if (editingTeam) {
            run(updateTeam(editingTeam.id, { name, color }), () =>
              toast.success("Team updated", { description: `${name} saved.` }),
            );
          } else {
            run(createTeam({ name, color, memberIds }), () =>
              toast.success("Team created", { description: `${name} is ready to go.` }),
            );
          }
        }}
      />

      <AlertDialog open={!!deletingTeam} onOpenChange={(o) => !o && setDeletingTeamId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingTeam?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingTeam &&
                (() => {
                  const memberCount = teamMemberCount(deletingTeam.id);
                  const projectCount = projects.filter((p) => p.teamId === deletingTeam.id).length;
                  const parts = [
                    memberCount > 0
                      ? `${memberCount} member${memberCount === 1 ? "" : "s"} (they'll need reassigning to another team)`
                      : null,
                    projectCount > 0
                      ? `${projectCount} project${projectCount === 1 ? "" : "s"} (they'll show as having no team)`
                      : null,
                  ].filter(Boolean);
                  return parts.length > 0
                    ? `This removes the team from the workspace. It's currently attached to ${parts.join(" and ")}.`
                    : "This removes the team from the workspace. Nothing is currently attached to it.";
                })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep team</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingTeam) {
                  run(deleteTeam(deletingTeam.id), () =>
                    toast.success("Team deleted", { description: `${deletingTeam.name} is gone.` }),
                  );
                }
                setDeletingTeamId(null);
              }}
            >
              Delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  defaultTeamId,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTeamId: string;
  onInvite: (payload: { emails: string[]; teamId: string; role: Role }) => void;
}) {
  const { teams } = useWorkspace();
  const [raw, setRaw] = useState("");
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [role, setRole] = useState<Role>("Member");

  useEffect(() => {
    if (open) {
      setRaw("");
      setTeamId(defaultTeamId || teams[0]?.id || "");
      setRole("Member");
    }
  }, [open, defaultTeamId, teams]);

  const emails = useMemo(
    () =>
      raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.includes("@")),
    [raw],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Add one email per line, or paste a few separated by commas — we'll send them all at
            once.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="invite-emails">Email addresses</Label>
            <Textarea
              id="invite-emails"
              rows={4}
              placeholder={"maya@ironbrij.com\ntom@ironbrij.com"}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {emails.length} valid {emails.length === 1 ? "address" : "addresses"} detected.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="invite-team">Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="invite-team">
                  <SelectValue placeholder="Pick a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="invite-role">
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
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={emails.length === 0 || !teamId}
            onClick={() => {
              onInvite({ emails, teamId, role });
              onOpenChange(false);
            }}
          >
            Send {emails.length > 1 ? `${emails.length} invites` : "invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamFormDialog({
  open,
  onOpenChange,
  team,
  people,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: { id: string; name: string; color: string } | null;
  people: { id: string; name: string; title: string; teamId: string; teamIds: string[] }[];
  onSubmit: (input: { name: string; color: string; memberIds: string[] }) => void;
}) {
  const { teams, addMemberToTeam, removeMemberFromTeam } = useWorkspace();
  const [name, setName] = useState(team?.name ?? "");
  const [color, setColor] = useState(team?.color ?? dotColors[0]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [originalMemberIds, setOriginalMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(team?.name ?? "");
      setColor(team?.color ?? dotColors[0]);
      const current = team
        ? people.filter((p) => p.teamIds.includes(team.id)).map((p) => p.id)
        : [];
      setMemberIds(current);
      setOriginalMemberIds(current);
    }
    // Only meant to seed the form when the dialog opens for a given team,
    // not re-sync continuously while someone's mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team]);

  const handleSubmit = async () => {
    onSubmit({ name: name.trim(), color, memberIds });
    if (team) {
      const originalSet = new Set(originalMemberIds);
      const nextSet = new Set(memberIds);
      const toAdd = memberIds.filter((id) => !originalSet.has(id));
      const toRemove = originalMemberIds.filter((id) => !nextSet.has(id));
      if (toAdd.length || toRemove.length) {
        setSaving(true);
        try {
          await Promise.all([
            ...toAdd.map((id) => addMemberToTeam(id, team.id)),
            ...toRemove.map((id) => removeMemberFromTeam(id, team.id)),
          ]);
        } catch (error) {
          toast.error("Some membership changes didn't save", {
            description: (error as Error).message,
          });
        } finally {
          setSaving(false);
        }
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "New team"}</DialogTitle>
          <DialogDescription>
            {team
              ? "Rename the team or give it a different colour."
              : "Name the team, pick a colour, and optionally bring people across right away."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              placeholder="e.g. Web Development"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Colour</Label>
            <ColorDotPicker value={color} onChange={setColor} />
          </div>
          <div className="grid gap-2">
            <Label>{team ? "People" : "Add people (optional)"}</Label>
            <MultiSelectList
              options={people.map((p) => ({
                id: p.id,
                label: p.name,
                hint: `${p.title} · ${
                  p.teamIds.length
                    ? p.teamIds
                        .map((id) => teams.find((t) => t.id === id)?.name)
                        .filter(Boolean)
                        .join(", ")
                    : "No team"
                }`,
              }))}
              selected={memberIds}
              onToggle={(id) =>
                setMemberIds((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              Checking someone adds them to this team — it won't remove them from any other team
              they're already on.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || saving} onClick={() => void handleSubmit()}>
            {team ? "Save team" : "Create team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
