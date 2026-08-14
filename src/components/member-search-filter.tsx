import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * M39: one name-search + team-filter, reused across every member-heavy
 * manager surface (Manage > Schedule, Entries, Approvals' week status list;
 * Settings > Users) instead of each independently lacking one. All of them
 * already read from the same `members`/`activeMembers` + `teamIds` shape,
 * so the filtering logic is shared too.
 */
export function filterMembersBySearchAndTeam<T extends { name: string; teamIds: string[] }>(
  members: T[],
  search: string,
  teamFilter: string,
): T[] {
  const q = search.trim().toLowerCase();
  return members
    .filter((m) => !q || m.name.toLowerCase().includes(q))
    .filter((m) => teamFilter === "all" || m.teamIds.includes(teamFilter));
}

export function MemberSearchFilter({
  search,
  onSearchChange,
  teamFilter,
  onTeamFilterChange,
  teams,
  placeholder = "Search people…",
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  teamFilter: string;
  onTeamFilterChange: (value: string) => void;
  teams: { id: string; name: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>
      <Select value={teamFilter} onValueChange={onTeamFilterChange}>
        <SelectTrigger className="w-44 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All teams</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
