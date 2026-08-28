import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectList } from "@/components/multi-select-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useWorkspace,
  type WorkspaceAnnouncement,
  type WorkspaceMember,
} from "@/lib/workspace-store";

export const Route = createFileRoute("/announcements")({
  head: () => ({
    meta: [
      { title: "Announcements — IronTrack" },
      {
        name: "description",
        content: "Company and team announcements from Ironbrij admins and managers.",
      },
      { property: "og:title", content: "Announcements — IronTrack" },
      { property: "og:description", content: "Company and team announcements." },
    ],
  }),
  component: AnnouncementsPage,
});

function formatPostedAt(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AnnouncementsPage() {
  const {
    announcements,
    teams,
    currentUser,
    isAdmin,
    canManage,
    memberById,
    createAnnouncement,
    deleteAnnouncement,
    markAnnouncementsSeen,
  } = useWorkspace();

  useEffect(() => {
    markAnnouncementsSeen();
  }, [markAnnouncementsSeen]);

  const [teamFilter, setTeamFilter] = useState("all");
  const filtered = announcements.filter(
    (a) => teamFilter === "all" || a.audience === "everyone" || a.teamIds.includes(teamFilter),
  );

  // Teams this person is actually allowed to target — admins get every
  // team plus "Everyone"; managers only their own, and never "Everyone",
  // matching create_announcement()'s own server-side check exactly.
  const postableTeams = isAdmin ? teams : teams.filter((t) => currentUser.teamIds.includes(t.id));

  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"everyone" | "teams">(isAdmin ? "everyone" : "teams");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const resetCompose = () => {
    setTitle("");
    setBody("");
    setAudience(isAdmin ? "everyone" : "teams");
    setSelectedTeamIds([]);
  };

  const submit = () => {
    if (!title.trim() || !body.trim()) return;
    if (audience === "teams" && selectedTeamIds.length === 0) {
      toast.error("Pick at least one team");
      return;
    }
    setPosting(true);
    createAnnouncement({ title, body, audience, teamIds: selectedTeamIds })
      .then(() => {
        toast.success("Announcement posted");
        setComposeOpen(false);
        resetCompose();
      })
      .catch((error: Error) => toast.error("Couldn't post that", { description: error.message }))
      .finally(() => setPosting(false));
  };

  const deletingAnnouncement = announcements.find((a) => a.id === deletingId) ?? null;

  return (
    <AppShell
      title="Announcements"
      subtitle="What's been shared with the team."
      actions={
        canManage && (
          <Button className="gap-2" onClick={() => setComposeOpen(true)}>
            <Plus className="h-4 w-4" /> New announcement
          </Button>
        )
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All announcements</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              {announcements.length === 0
                ? "Nothing's been posted yet."
                : "Nothing posted for this team."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              author={memberById(a.authorId)}
              teamNames={a.teamIds
                .map((id) => teams.find((t) => t.id === id)?.name)
                .filter((n): n is string => !!n)}
              canDelete={canManage && (isAdmin || a.authorId === currentUser.id)}
              onDelete={() => setDeletingId(a.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={composeOpen}
        onOpenChange={(open) => {
          setComposeOpen(open);
          if (!open) resetCompose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              This posts immediately and emails everyone in the audience.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="announcement-title">Title</Label>
              <Input
                id="announcement-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Office closed Monday"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="announcement-body">Message</Label>
              <Textarea
                id="announcement-body"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What do you want the team to know?"
              />
            </div>
            <div className="grid gap-2">
              <Label>Audience</Label>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as "everyone" | "teams")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isAdmin && <SelectItem value="everyone">Everyone</SelectItem>}
                  <SelectItem value="teams">Specific team(s)</SelectItem>
                </SelectContent>
              </Select>
              {audience === "teams" && (
                <MultiSelectList
                  options={postableTeams.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
                  selected={selectedTeamIds}
                  onToggle={(id) =>
                    setSelectedTeamIds((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                    )
                  }
                  emptyLabel="You're not on any team yet — nothing to target."
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={posting} onClick={submit}>
              Post announcement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingAnnouncement?.title
                ? `"${deletingAnnouncement.title}" will be removed for everyone who could see it. This can't be undone.`
                : "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={() => {
                if (!deletingId) return;
                setDeleteBusy(true);
                deleteAnnouncement(deletingId)
                  .then(() => toast.success("Announcement deleted"))
                  .catch((error: Error) =>
                    toast.error("Couldn't delete that", { description: error.message }),
                  )
                  .finally(() => {
                    setDeleteBusy(false);
                    setDeletingId(null);
                  });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function AnnouncementCard({
  announcement,
  author,
  teamNames,
  canDelete,
  onDelete,
}: {
  announcement: WorkspaceAnnouncement;
  author: WorkspaceMember | undefined;
  teamNames: string[];
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <Card className="shadow-card">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={author?.avatarUrl ?? undefined} alt={author?.name ?? ""} />
              <AvatarFallback className="bg-secondary text-xs">
                {author?.initials ?? "—"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{author?.name ?? "Former member"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {formatPostedAt(announcement.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">
              {announcement.audience === "everyone" ? "Everyone" : teamNames.join(", ") || "Team"}
            </Badge>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Delete announcement"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
        <h3 className="mt-3 text-base font-semibold">{announcement.title}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
          {announcement.body}
        </p>
      </CardContent>
    </Card>
  );
}
