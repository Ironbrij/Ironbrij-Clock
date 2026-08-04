import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Clock,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plane,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

const nav = [
  { to: "/time", label: "Time", icon: Clock },
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/teams", label: "Team", icon: Users },
  { to: "/time-off", label: "Time off", icon: Plane },
  { to: "/manage", label: "Manage", icon: SlidersHorizontal },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { session, authLoading, currentUser, isAdmin, members, signOut } = useWorkspace();

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", replace: true });
  }, [authLoading, session, navigate]);

  if (authLoading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Signed in, but an admin hasn't approved this account yet — block the
  // dashboard instead of falling through. Admins skip this even if their own
  // record happens to still be marked pending, so nobody can lock out every
  // admin at once.
  if (currentUser.pending && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Awaiting approval</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You're signed in, but an admin hasn't approved your account yet. You'll get
            access as soon as they do — no need to sign in again.
          </p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const pendingCount = isAdmin
    ? members.filter((m) => m.pending).length
    : 0;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 block px-2">
          <img src="/ironbrij-wordmark.png" alt="Ironbrij" className="h-8 w-auto dark:brightness-0 dark:invert" />
          <span className="mt-1 block text-xs font-medium text-muted-foreground">Time tracking</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            const showBadge = item.to === "/settings" && pendingCount > 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
                {showBadge && (
                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {currentUser.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{currentUser.name}</p>
            <p className="truncate text-xs text-muted-foreground">{currentUser.title || currentUser.role}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Sign out"
            onClick={() => {
              void signOut().then(() => navigate({ to: "/login", replace: true }));
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-background/85 px-5 py-4 backdrop-blur sm:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
        <nav className="sticky bottom-0 flex items-center justify-around border-t border-border bg-background px-2 py-2 lg:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground [&.active]:text-primary"
              activeProps={{ className: "active" }}
              activeOptions={{ exact: true }}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function ProjectDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}
