import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { ColorDotPicker } from "@/components/color-dot-picker";
import { MultiSelectList } from "@/components/multi-select-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHours } from "@/lib/mock-data";
import {
  dotColors,
  NO_CLIENT,
  useWorkspace,
  useWorkspaceClients,
  useWorkspaceTags,
  type ProjectInput,
  type WorkspaceTag,
  type WorkspaceProject,
} from "@/lib/workspace-store";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Ironbrij Time" },
      {
        name: "description",
        content:
          "Browse and manage Ironbrij projects, clients and tags with assigned members and total hours logged.",
      },
      { property: "og:title", content: "Projects — Ironbrij Time" },
      { property: "og:description", content: "Projects, clients and tags with hours logged." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [tab, setTab] = useState("projects");
  const {
    projects,
    teams,
    activeMembers,
    memberById,
    canManage,
    createProject,
    updateProject,
    archiveProject,
    clients: realClients,
    createClient,
    updateClient,
    deleteClient,
  } = useWorkspace();
  const clientGroups = useWorkspaceClients();
  const tags = useWorkspaceTags();
  const clientNames = useMemo(() => {
    const names = realClients.map((c) => c.name).filter((n) => n !== NO_CLIENT);
    return [NO_CLIENT, ...names];
  }, [realClients]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const editing = projects.find((p) => p.id === editingId) ?? null;
  const archiving = projects.find((p) => p.id === archivingId) ?? null;

  return (
    <AppShell
      title="Projects"
      subtitle="Projects, the clients behind them, and the tags you log against."
      actions={
        canManage ? (
          <Button
            className="gap-2"
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New project
          </Button>
        ) : undefined
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "clients" && (
        <ClientsTab
          clients={realClients.map((rc) => {
            const group = clientGroups.find((g) => g.name === rc.name);
            return {
              id: rc.id,
              name: rc.name,
              projects: group?.projects ?? [],
              hours: group?.hours ?? 0,
            };
          })}
          createClient={createClient}
          updateClient={updateClient}
          deleteClient={deleteClient}
        />
      )}
      {tab === "tags" && <TagsTab tags={tags} />}
      {tab === "projects" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const team = teams.find((t) => t.id === p.teamId);
            const projectTags = tags.filter((t) => p.tagIds.includes(t.id));
            return (
              <Card
                key={p.id}
                onClick={
                  canManage
                    ? () => {
                        setEditingId(p.id);
                        setFormOpen(true);
                      }
                    : undefined
                }
                className={
                  "shadow-card transition-shadow hover:shadow-elevated " +
                  (canManage ? "cursor-pointer " : "") +
                  (p.archived ? "opacity-60" : "")
                }
              >
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5">
                      <ProjectDot color={p.color} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold leading-snug">{p.name}</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{p.client}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="w-fit rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{
                        backgroundColor: `color-mix(in oklab, ${p.color} 14%, transparent)`,
                        color: p.color,
                      }}
                    >
                      {team?.name ?? "No team"}
                    </span>
                    {projectTags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `color-mix(in oklab, ${t.color} 14%, transparent)`,
                          color: t.color,
                        }}
                      >
                        {t.name}
                      </span>
                    ))}
                    {!p.billable && (
                      <Badge variant="secondary" className="text-[10px]">
                        Non-billable
                      </Badge>
                    )}
                    {p.archived && (
                      <Badge variant="outline" className="text-[10px]">
                        Archived
                      </Badge>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <div className="flex -space-x-2">
                      {p.memberIds.map((id) => {
                        const m = memberById(id);
                        if (!m) return null;
                        return (
                          <Avatar key={id} className="h-8 w-8 border-2 border-card">
                            <AvatarFallback className="bg-secondary text-[11px] text-secondary-foreground">
                              {m.initials}
                            </AvatarFallback>
                          </Avatar>
                        );
                      })}
                    </div>
                    <span className="text-sm font-medium tabular-nums">{formatHours(p.hours)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectFormDialog
        key={editing?.id ?? "new-project"}
        open={formOpen}
        onOpenChange={setFormOpen}
        project={editing}
        clientNames={clientNames}
        teams={teams}
        people={activeMembers}
        tags={tags}
        onSubmit={(input) => {
          if (editing) {
            updateProject(editing.id, input)
              .then(() => toast.success("Project updated", { description: `${input.name} saved.` }))
              .catch((error: Error) =>
                toast.error("Couldn't save", { description: error.message }),
              );
          } else {
            createProject(input)
              .then(() =>
                toast.success("Project created", {
                  description: `${input.name} is ready for time entries.`,
                }),
              )
              .catch((error: Error) =>
                toast.error("Couldn't create", { description: error.message }),
              );
          }
        }}
        onArchive={() => {
          setFormOpen(false);
          setArchivingId(editing?.id ?? null);
        }}
      />

      <AlertDialog open={!!archiving} onOpenChange={(o) => !o && setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides the project from new time entries but keeps every hour already logged.
              You can bring it back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiving) {
                  archiveProject(archiving.id)
                    .then(() =>
                      toast.success("Project archived", {
                        description: `${archiving.name} is now archived.`,
                      }),
                    )
                    .catch((error: Error) =>
                      toast.error("Couldn't archive", { description: error.message }),
                    );
                }
                setArchivingId(null);
              }}
            >
              Archive project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  clientNames,
  teams,
  people,
  tags,
  onSubmit,
  onArchive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: WorkspaceProject | null;
  clientNames: string[];
  teams: { id: string; name: string; color: string }[];
  people: { id: string; name: string; title: string }[];
  tags: WorkspaceTag[];
  onSubmit: (input: ProjectInput) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [teamId, setTeamId] = useState("");
  const [color, setColor] = useState(dotColors[0]);
  const [billable, setBillable] = useState(true);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setClient(project?.client ?? clientNames[0] ?? "");
    setTeamId(project?.teamId ?? teams[0]?.id ?? "");
    setColor(project?.color ?? dotColors[0]);
    setBillable(project?.billable ?? true);
    setTagIds(project?.tagIds ?? []);
    setMemberIds(project?.memberIds ?? []);
  }, [open, project, clientNames, teams]);

  const toggle = (setter: (fn: (prev: string[]) => string[]) => void) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {project
              ? "Update the details, or archive the project when the work wraps up."
              : "Set up a project so your team can start logging time against it."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              placeholder="e.g. Northshore Dental Rebuild"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="project-client">Client</Label>
              <Select value={client} onValueChange={setClient}>
                <SelectTrigger id="project-client">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {clientNames.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-team">Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger id="project-team">
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
          </div>
          <div className="grid gap-2">
            <Label>Colour tag</Label>
            <ColorDotPicker value={color} onChange={setColor} />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Billable project</p>
              <p className="text-xs text-muted-foreground">
                Hours logged here count towards client invoices.
              </p>
            </div>
            <Switch checked={billable} onCheckedChange={setBillable} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Tags</Label>
              <MultiSelectList
                options={tags.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
                selected={tagIds}
                onToggle={toggle(setTagIds)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Assigned members</Label>
              <MultiSelectList
                options={people.map((p) => ({ id: p.id, label: p.name, hint: p.title }))}
                selected={memberIds}
                onToggle={toggle(setMemberIds)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {project && !project.archived ? (
            <Button variant="outline" className="gap-2 text-destructive" onClick={onArchive}>
              <Archive className="h-4 w-4" /> Archive project
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || !client || !teamId}
              onClick={() => {
                onSubmit({ name: name.trim(), client, teamId, color, billable, tagIds, memberIds });
                onOpenChange(false);
              }}
            >
              {project ? "Save project" : "Create project"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientsTab({
  clients,
  createClient,
  updateClient,
  deleteClient,
}: {
  clients: { id: string; name: string; projects: WorkspaceProject[]; hours: number }[];
  createClient: (name: string) => Promise<void>;
  updateClient: (id: string, name: string) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    projectCount: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await createClient(name);
      setNewName("");
      toast.success("Client added");
    } catch (error) {
      toast.error("Couldn't add that", { description: (error as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const saveEdit = async () => {
    const id = editingId;
    const original = clients.find((c) => c.id === id)?.name ?? "";
    const name = editName.trim();
    setEditingId(null);
    if (!id || !name || name === original) return;
    try {
      await updateClient(id, name);
      toast.success("Client renamed");
    } catch (error) {
      toast.error("Couldn't rename that", { description: (error as Error).message });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClient(deleteTarget.id);
      toast.success("Client removed");
      setDeleteTarget(null);
    } catch (error) {
      toast.error("Couldn't remove that", { description: (error as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Card className="min-w-0 shadow-card">
        <CardContent className="p-0">
          {clients.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No clients yet — add one below.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {clients.map((c) => (
                <li
                  key={c.id}
                  className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    {editingId === c.id ? (
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => void saveEdit()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8 max-w-xs"
                      />
                    ) : (
                      <p className="truncate text-sm font-medium">{c.name}</p>
                    )}
                    {c.projects.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.projects.map((p) => (
                          <span
                            key={p.id}
                            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `color-mix(in oklab, ${p.color} 14%, transparent)`,
                              color: p.color,
                            }}
                          >
                            <ProjectDot color={p.color} />
                            {p.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-medium tabular-nums">{formatHours(c.hours)}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.projects.length} {c.projects.length === 1 ? "project" : "projects"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Rename ${c.name}`}
                        onClick={() => startEdit(c.id, c.name)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${c.name}`}
                        onClick={() =>
                          setDeleteTarget({
                            id: c.id,
                            name: c.name,
                            projectCount: c.projects.length,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Input
          placeholder="New client name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <Button disabled={adding || !newName.trim()} onClick={() => void add()}>
          Add client
        </Button>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.projectCount > 0
                ? `${deleteTarget.projectCount} project${deleteTarget.projectCount === 1 ? "" : "s"} currently ${
                    deleteTarget.projectCount === 1 ? "uses" : "use"
                  } this client — they'll show as having no client afterward. Nothing else is affected.`
                : "This client isn't attached to any projects, so nothing else is affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void confirmDelete()}>
              Remove client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TagsTab({ tags }: { tags: WorkspaceTag[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {tags.map((t) => (
        <Card key={t.id} className="shadow-card">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <span
              className="flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-medium"
              style={{
                backgroundColor: `color-mix(in oklab, ${t.color} 14%, transparent)`,
                color: t.color,
              }}
            >
              <ProjectDot color={t.color} />
              {t.name}
            </span>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {t.entryCount} entries
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
