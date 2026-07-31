import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatHours, memberById, projects, teams } from "@/lib/mock-data";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Ironbrij Time" },
      { name: "description", content: "Browse Ironbrij client and internal projects with assigned members and total hours logged." },
      { property: "og:title", content: "Projects — Ironbrij Time" },
      { property: "og:description", content: "Client and internal projects with hours logged." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <AppShell
      title="Projects"
      subtitle="Six active projects across client work and internal builds."
      actions={
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New project
        </Button>
      }
    >
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
    </AppShell>
  );
}