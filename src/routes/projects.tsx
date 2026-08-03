import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clients, formatHours, memberById, projects, tags, teams } from "@/lib/mock-data";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Ironbrij Time" },
      { name: "description", content: "Browse Ironbrij projects, clients and tags with assigned members and total hours logged." },
      { property: "og:title", content: "Projects — Ironbrij Time" },
      { property: "og:description", content: "Projects, clients and tags with hours logged." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [tab, setTab] = useState("projects");

  return (
    <AppShell
      title="Projects"
      subtitle="Projects, the clients behind them, and the tags you log against."
      actions={
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New project
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "clients" && <ClientsTab />}
      {tab === "tags" && <TagsTab />}
      {tab === "projects" && (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const team = teams.find((t) => t.id === p.teamId);
          return (
            <Card key={p.id} className="shadow-card transition-shadow hover:shadow-elevated">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5"><ProjectDot color={p.color} /></span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold leading-snug">{p.name}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{p.client}</p>
                  </div>
                </div>
                <span
                  className="w-fit rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `color-mix(in oklab, ${p.color} 14%, transparent)`, color: p.color }}
                >
                  {team?.name}
                </span>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <div className="flex -space-x-2">
                    {p.memberIds.map((id) => {
                      const m = memberById(id);
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
    </AppShell>
  );
}

function ClientsTab() {
  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {clients.map((c) => (
            <li key={c.name} className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
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
              </div>
              <div className="text-left sm:text-right">
                <p className="text-sm font-medium tabular-nums">{formatHours(c.hours)}</p>
                <p className="text-xs text-muted-foreground">
                  {c.projects.length} {c.projects.length === 1 ? "project" : "projects"} ·{" "}
                  {c.internal ? "Internal" : "Client"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TagsTab() {
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