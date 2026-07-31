import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { membersByTeam, teamMemberCount, teams } from "@/lib/mock-data";

export const Route = createFileRoute("/teams")({
  head: () => ({
    meta: [
      { title: "Teams — Ironbrij Time" },
      { name: "description", content: "All 13 Ironbrij internal teams, their members and roles across delivery, design, SEO, VA operations and more." },
      { property: "og:title", content: "Teams — Ironbrij Time" },
      { property: "og:description", content: "The 13 internal Ironbrij teams and their members." },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const [selected, setSelected] = useState(teams[0].id);
  const team = teams.find((t) => t.id === selected)!;
  const roster = membersByTeam(selected);

  return (
    <AppShell title="Teams" subtitle="13 teams, one workspace. Pick a team to see who's in it.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="shadow-card">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {teams.map((t) => {
                const roster = membersByTeam(t.id);
                return (
                  <li key={t.id}>
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
                          style={{ backgroundColor: `color-mix(in oklab, ${t.color} 22%, transparent)` }}
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
                          {roster.slice(0, 3).map((m) => (
                            <Avatar key={m.id} className="h-7 w-7 border-2 border-card">
                              <AvatarFallback className="bg-secondary text-[10px]">{m.initials}</AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="h-fit shadow-card">
          <CardContent className="p-5">
            <h2 className="text-base font-semibold">{team.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {teamMemberCount(team.id)} members
            </p>
            {roster.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No one's been added to this team yet — it's a quiet corner of the workspace for now.
              </p>
            ) : (
              <ul className="mt-5 space-y-3">
                {roster.map((m) => (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-secondary text-xs">{m.initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.title}</p>
                      </div>
                    </div>
                    <Badge variant={m.role === "Admin" ? "default" : "secondary"}>{m.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}