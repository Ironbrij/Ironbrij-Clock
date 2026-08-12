import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  Info,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { ColorDotPicker } from "@/components/color-dot-picker";
import { MultiSelectList } from "@/components/multi-select-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
import { formatHours, formatMinutes } from "@/lib/mock-data";
import { formatDayLong, fromDateKey } from "@/lib/time-utils";
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
      { title: "Projects — IronTrack" },
      {
        name: "description",
        content:
          "Browse and manage Ironbrij projects, clients and tags with assigned members and total hours logged.",
      },
      { property: "og:title", content: "Projects — IronTrack" },
      { property: "og:description", content: "Projects, clients and tags with hours logged." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [tab, setTab] = useState("projects");
  const {
    projects: allProjects,
    teams,
    activeMembers,
    memberById,
    canManage,
    createProject,
    updateProject,
    archiveProject,
    unarchiveProject,
    deleteProject,
    clients: realClients,
    createClient,
    updateClient,
    setClientActive,
    updateClientProfile,
    deleteClient,
    createTag,
    updateTag,
    deleteTag,
  } = useWorkspace();
  // Archived projects are only relevant to the people who manage them —
  // everyone else just sees the active roster, not a dimmed-out history.
  const projects = useMemo(
    () => (canManage ? allProjects : allProjects.filter((p) => !p.archived)),
    [allProjects, canManage],
  );
  const clientGroups = useWorkspaceClients();
  const tags = useWorkspaceTags();
  const clientNames = useMemo(() => {
    const names = realClients.map((c) => c.name).filter((n) => n !== NO_CLIENT);
    return [NO_CLIENT, ...names];
  }, [realClients]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const editing = projects.find((p) => p.id === editingId) ?? null;
  const archiving = projects.find((p) => p.id === archivingId) ?? null;
  const projectToDelete = projects.find((p) => p.id === deletingId) ?? null;

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
              active: rc.active,
              basecampUrl: rc.basecampUrl,
              contactName: rc.contactName,
              contactEmail: rc.contactEmail,
              subscriptionHours: rc.subscriptionHours,
              projects: group?.projects ?? [],
              hours: group?.hours ?? 0,
            };
          })}
          createClient={createClient}
          updateClient={updateClient}
          setClientActive={setClientActive}
          updateClientProfile={updateClientProfile}
          deleteClient={deleteClient}
          canManage={canManage}
        />
      )}
      {tab === "tags" && (
        <TagsTab
          tags={tags}
          createTag={createTag}
          updateTag={updateTag}
          deleteTag={deleteTag}
          canManage={canManage}
        />
      )}
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
        onUnarchive={() => {
          if (!editing) return;
          setFormOpen(false);
          void unarchiveProject(editing.id)
            .then(() =>
              toast.success("Project unarchived", {
                description: `${editing.name} is active again.`,
              }),
            )
            .catch((error: Error) =>
              toast.error("Couldn't unarchive", { description: error.message }),
            );
        }}
        onDelete={() => {
          setFormOpen(false);
          setDeletingId(editing?.id ?? null);
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

      <AlertDialog
        open={!!projectToDelete}
        onOpenChange={(o) => {
          if (!o) {
            setDeletingId(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {projectToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.{" "}
              {projectToDelete && projectToDelete.hours > 0
                ? `${formatHours(projectToDelete.hours)} of time entries are logged against it —`
                : "Any time entries already logged against it are"}{" "}
              kept, not deleted — they'll just show as having no project from now on, which will
              change how past reports for this project read. Type the project name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label
              htmlFor="confirm-delete-project"
              className="text-sm font-medium text-destructive"
            >
              Project name
            </Label>
            <Input
              id="confirm-delete-project"
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={projectToDelete?.name}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleting ||
                !projectToDelete ||
                deleteConfirmText.trim().toLowerCase() !== projectToDelete.name.trim().toLowerCase()
              }
              onClick={async () => {
                if (!projectToDelete) return;
                setDeleting(true);
                try {
                  await deleteProject(projectToDelete.id);
                  toast.success("Project deleted", {
                    description: `${projectToDelete.name} has been permanently removed.`,
                  });
                  setDeletingId(null);
                  setDeleteConfirmText("");
                } catch (error) {
                  toast.error("Couldn't delete that", { description: (error as Error).message });
                } finally {
                  setDeleting(false);
                }
              }}
            >
              Delete permanently
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
  onUnarchive,
  onDelete,
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
  onUnarchive: () => void;
  onDelete: () => void;
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
          {project && !project.archived && (
            <Button variant="outline" className="gap-2 text-destructive" onClick={onArchive}>
              <Archive className="h-4 w-4" /> Archive project
            </Button>
          )}
          {project && project.archived && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" onClick={onUnarchive}>
                <ArchiveRestore className="h-4 w-4" /> Unarchive
              </Button>
              <Button variant="outline" className="gap-2 text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" /> Delete permanently
              </Button>
            </div>
          )}
          {!project && <span />}
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

const CLIENTS_PAGE_SIZE = 10;

function ClientsTab({
  clients,
  createClient,
  updateClient,
  setClientActive,
  updateClientProfile,
  deleteClient,
  canManage,
}: {
  clients: {
    id: string;
    name: string;
    active: boolean;
    basecampUrl: string | null;
    contactName: string | null;
    contactEmail: string | null;
    subscriptionHours: number | null;
    projects: WorkspaceProject[];
    hours: number;
  }[];
  createClient: (name: string) => Promise<void>;
  updateClient: (id: string, name: string) => Promise<void>;
  setClientActive: (id: string, active: boolean) => Promise<void>;
  updateClientProfile: (
    id: string,
    profile: {
      basecampUrl: string | null;
      contactName: string | null;
      contactEmail: string | null;
      subscriptionHours: number | null;
    },
  ) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  canManage: boolean;
}) {
  const [viewingId, setViewingId] = useState<string | null>(null);
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
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .filter((c) => showInactive || c.active)
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [clients, showInactive, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENTS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (currentPage - 1) * CLIENTS_PAGE_SIZE,
    currentPage * CLIENTS_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, showInactive]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await createClient(name);
      setNewName("");
      setSearch("");
      setPage(1);
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

  const toggleActive = async (c: { id: string; name: string; active: boolean }) => {
    setTogglingId(c.id);
    try {
      await setClientActive(c.id, !c.active);
      toast.success(c.active ? `${c.name} marked inactive` : `${c.name} marked active`);
    } catch (error) {
      toast.error("Couldn't update that", { description: (error as Error).message });
    } finally {
      setTogglingId(null);
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
      {canManage && (
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
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(!!v)} />
          Show inactive
        </label>
      </div>

      <Card className="min-w-0 shadow-card">
        <CardContent className="p-0">
          {paged.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {clients.length === 0
                ? "No clients yet — add one above."
                : "No clients match your search."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {paged.map((c) => (
                <li
                  key={c.id}
                  className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
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
                      {!c.active && (
                        <Badge variant="outline" className="shrink-0 text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
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
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`View ${c.name}'s profile`}
                      onClick={() => setViewingId(c.id)}
                    >
                      <Info className="h-4 w-4" />
                    </Button>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={togglingId === c.id}
                          aria-label={
                            c.active ? `Mark ${c.name} inactive` : `Mark ${c.name} active`
                          }
                          onClick={() => void toggleActive(c)}
                        >
                          {c.active ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
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
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "client" : "clients"}
            {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
          </p>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    className={
                      currentPage <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                    }
                    onClick={() => currentPage > 1 && setPage(currentPage - 1)}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    className={
                      currentPage >= totalPages
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                    onClick={() => currentPage < totalPages && setPage(currentPage + 1)}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

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

      <ClientProfileDialog
        client={clients.find((c) => c.id === viewingId) ?? null}
        canManage={canManage}
        updateClientProfile={updateClientProfile}
        onOpenChange={(open) => !open && setViewingId(null)}
      />
    </div>
  );
}

function ClientProfileDialog({
  client,
  canManage,
  updateClientProfile,
  onOpenChange,
}: {
  client: {
    id: string;
    name: string;
    basecampUrl: string | null;
    contactName: string | null;
    contactEmail: string | null;
    subscriptionHours: number | null;
    hours: number;
  } | null;
  canManage: boolean;
  updateClientProfile: (
    id: string,
    profile: {
      basecampUrl: string | null;
      contactName: string | null;
      contactEmail: string | null;
      subscriptionHours: number | null;
    },
  ) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [basecampUrl, setBasecampUrl] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [subscriptionHours, setSubscriptionHours] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setBasecampUrl(client.basecampUrl ?? "");
      setContactName(client.contactName ?? "");
      setContactEmail(client.contactEmail ?? "");
      setSubscriptionHours(
        client.subscriptionHours != null ? String(client.subscriptionHours) : "",
      );
      setEditing(false);
    }
  }, [client]);

  if (!client) return null;

  const rendered = client.hours;
  const subscription = client.subscriptionHours;
  const remaining = subscription != null ? subscription - rendered : null;

  const save = async () => {
    setSaving(true);
    try {
      const parsedHours = subscriptionHours.trim() === "" ? null : Number(subscriptionHours);
      await updateClientProfile(client.id, {
        basecampUrl: basecampUrl.trim() || null,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        subscriptionHours: parsedHours != null && !Number.isNaN(parsedHours) ? parsedHours : null,
      });
      toast.success("Client profile updated");
      setEditing(false);
    } catch (error) {
      toast.error("Couldn't save that", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client.name}</DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="client-contact-name">Contact name</Label>
              <Input
                id="client-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-contact-email">Client email</Label>
              <Input
                id="client-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="jane@client.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-basecamp">Basecamp link</Label>
              <Input
                id="client-basecamp"
                value={basecampUrl}
                onChange={(e) => setBasecampUrl(e.target.value)}
                placeholder="https://3.basecamp.com/..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-subscription">Subscription hours</Label>
              <Input
                id="client-subscription"
                type="number"
                min="0"
                step="0.5"
                value={subscriptionHours}
                onChange={(e) => setSubscriptionHours(e.target.value)}
                placeholder="e.g. 40"
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-5 py-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Contact</p>
                <p className="mt-0.5 font-medium">{client.contactName || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                {client.contactEmail ? (
                  <a
                    href={`mailto:${client.contactEmail}`}
                    className="mt-0.5 block truncate font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {client.contactEmail}
                  </a>
                ) : (
                  <p className="mt-0.5 font-medium">—</p>
                )}
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Basecamp</p>
                {client.basecampUrl ? (
                  <a
                    href={client.basecampUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block truncate font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {client.basecampUrl}
                  </a>
                ) : (
                  <p className="mt-0.5 font-medium">—</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-4">
              <div className="text-center">
                <p className="text-lg font-semibold tabular-nums">
                  {subscription != null ? formatHours(subscription) : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Subscription</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold tabular-nums">{formatHours(rendered)}</p>
                <p className="text-xs text-muted-foreground">Rendered</p>
              </div>
              <div className="text-center">
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    remaining != null && remaining < 0 ? "text-destructive" : ""
                  }`}
                >
                  {remaining != null ? formatHours(remaining) : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Remaining</p>
              </div>
            </div>
            {subscription != null && remaining != null && remaining < 0 && (
              <p className="-mt-3 text-xs text-destructive">
                This client has used {formatHours(Math.abs(remaining))} beyond their subscription.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {canManage && <Button onClick={() => setEditing(true)}>Edit profile</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagsTab({
  tags,
  createTag,
  updateTag,
  deleteTag,
  canManage,
}: {
  tags: WorkspaceTag[];
  createTag: (name: string, color: string) => Promise<void>;
  updateTag: (id: string, name: string, color: string) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  canManage: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<WorkspaceTag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceTag | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewingTag, setViewingTag] = useState<WorkspaceTag | null>(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTag(deleteTarget.id);
      toast.success("Tag deleted");
      setDeleteTarget(null);
    } catch (error) {
      toast.error("Couldn't delete that", { description: (error as Error).message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            className="gap-2"
            onClick={() => {
              setEditingTag(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New tag
          </Button>
        </div>
      )}

      {tags.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            No tags yet — add one to start categorizing projects.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tags.map((t) => (
            <Card
              key={t.id}
              className="min-w-0 cursor-pointer shadow-card transition-shadow hover:shadow-elevated"
              onClick={() => setViewingTag(t)}
            >
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <span
                  className="flex min-w-0 items-center gap-2 rounded-full px-2.5 py-1 text-sm font-medium"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${t.color} 14%, transparent)`,
                    color: t.color,
                  }}
                >
                  <ProjectDot color={t.color} />
                  <span className="truncate">{t.name}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-sm text-muted-foreground tabular-nums">{t.entryCount}</span>
                  {canManage && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTag(t);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(t);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TagFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        tag={editingTag}
        createTag={createTag}
        updateTag={updateTag}
      />

      <TagEntriesDialog tag={viewingTag} onOpenChange={(open) => !open && setViewingTag(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.entryCount > 0
                ? `Currently on ${deleteTarget.entryCount} time ${
                    deleteTarget.entryCount === 1 ? "entry" : "entries"
                  }. It'll be removed from any projects using it, and won't appear as a choice going
                    forward. Past time entries keep their own history regardless — nothing about
                    them changes.`
                : "It'll be removed from any projects using it, and won't appear as a choice going forward."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void confirmDelete()}>
              Delete tag
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TagFormDialog({
  open,
  onOpenChange,
  tag,
  createTag,
  updateTag,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: WorkspaceTag | null;
  createTag: (name: string, color: string) => Promise<void>;
  updateTag: (id: string, name: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(dotColors[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "");
      setColor(tag?.color ?? dotColors[0]);
    }
  }, [open, tag]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give it a name first");
      return;
    }
    setSaving(true);
    try {
      if (tag) {
        await updateTag(tag.id, trimmed, color);
        toast.success("Tag updated");
      } else {
        await createTag(trimmed, color);
        toast.success("Tag added");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't save that", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="tag-name">Name</Label>
            <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Colour</Label>
            <ColorDotPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {tag ? "Save changes" : "Add tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagEntriesDialog({
  tag,
  onOpenChange,
}: {
  tag: WorkspaceTag | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { entriesForTag, projectById, memberById, currentUser } = useWorkspace();
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof entriesForTag>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tag) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    entriesForTag(tag.id)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((error: Error) => toast.error("Couldn't load entries", { description: error.message }))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tag, entriesForTag]);

  return (
    <Dialog open={!!tag} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tag && <ProjectDot color={tag.color} />}
            {tag?.name}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? "Loading…"
              : `${entries?.length ?? 0} ${entries?.length === 1 ? "entry" : "entries"}${
                  (entries?.length ?? 0) >= 200 ? " (showing the most recent 200)" : ""
                }. Only entries you're allowed to see are shown — the same rule as everywhere else in the app.`}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !entries || entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No entries carry this tag yet — at least none you have access to see.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => {
              const project = projectById(e.projectId);
              const member = memberById(e.userId);
              return (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <ProjectDot color={project?.color ?? "var(--muted-foreground)"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {e.description || "No description"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {project?.name ?? "No project"} · {formatDayLong(fromDateKey(e.date))}
                      {member && member.id !== currentUser.id ? ` · ${member.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatMinutes(e.minutes)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
