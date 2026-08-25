import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Clock,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plane,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-store";

const nav = [
  { to: "/time", label: "Time", icon: Clock },
  { to: "/timesheet", label: "Timesheet", icon: ClipboardList },
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/teams", label: "Team", icon: Users },
  { to: "/time-off", label: "Time off", icon: Plane },
  { to: "/manage", label: "Manage", icon: SlidersHorizontal },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

// Mobile only — the desktop sidebar has room for all of nav. These three
// are what everyone, regardless of role, actually opens day to day;
// everything else sits one tap behind "More" instead of competing for
// space in a row of 9 icons.
const mobilePrimaryNav = nav.filter((item) => ["/time", "/timesheet", "/"].includes(item.to));
const mobileOverflowNav = nav.filter((item) => !["/time", "/timesheet", "/"].includes(item.to));

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
  const {
    session,
    authLoading,
    loading,
    loadError,
    currentUser,
    isAdmin,
    activeMembers,
    unseenActivityCount,
    pendingApprovals,
    signOut,
    refreshAll,
  } = useWorkspace();
  const [moreOpen, setMoreOpen] = useState(false);

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

  // The core "shell" data (profile, teams, projects, tags, settings,
  // timesheets, task categories) is still in flight — block on it rather
  // than letting every page underneath render with empty arrays and look
  // like a workspace with nothing in it.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Same data, but it came back an outright error rather than just being
  // slow — without this, a dropped connection or a transient failure here
  // renders exactly like an empty workspace on every single page, with no
  // way to tell the difference or retry.
  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Couldn't load your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Something went wrong loading your data. Check your connection and try again.
          </p>
          <Button className="mt-6 w-full" onClick={() => refreshAll()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Signed in, but nobody's approved this account yet — block the
  // dashboard instead of falling through. This used to exempt admins so
  // nobody could lock out every admin at once, but that exemption was
  // exactly what let a freshly admin-invited account skip approval
  // entirely (role is set at invite time, before any human reviews it).
  // The extreme edge case this exemption was guarding against — the
  // only admin somehow stuck pending — is recoverable directly in
  // Supabase's SQL editor if it ever genuinely happens; that's a safer
  // trade than leaving this bypass in place.
  if (currentUser.pending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Awaiting approval</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You're signed in, but an admin hasn't approved your account yet. You'll get access as
            soon as they do — no need to sign in again.
          </p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const pendingCount = isAdmin ? activeMembers.filter((m) => m.pending).length : 0;
  // H22: pendingApprovals is already RLS-scoped to timesheets this viewer
  // can review (shared-team for a manager, all for an admin), so folding
  // it into the same badge as unseen activity needs no extra role check.
  const manageBadgeCount = unseenActivityCount + pendingApprovals.length;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2.5 px-2">
          <img
            src="/ironbrij-mark.png"
            alt="IronTrack"
            className="h-8 w-8 shrink-0 dark:brightness-0 dark:invert"
          />
          <div className="min-w-0">
            <span className="block truncate text-base font-semibold text-sidebar-foreground">
              IronTrack
            </span>
            <span className="block text-xs font-medium text-muted-foreground">Time tracking</span>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            const badgeCount =
              item.to === "/settings" ? pendingCount : item.to === "/manage" ? manageBadgeCount : 0;
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
                {badgeCount > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={currentUser.avatarUrl ?? undefined} alt={currentUser.name} />
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {currentUser.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{currentUser.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {currentUser.title || currentUser.role}
            </p>
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
        <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
        <nav className="sticky bottom-0 flex items-center justify-around border-t border-border bg-background px-2 py-2 lg:hidden">
          {mobilePrimaryNav.map((item) => (
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
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground",
              mobileOverflowNav.some((item) => pathname === item.to) && "text-primary",
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
            More
            {(pendingCount > 0 || manageBadgeCount > 0) && (
              <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-destructive" />
            )}
          </button>
        </nav>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl lg:hidden">
            <SheetHeader>
              <SheetTitle className="text-left">More</SheetTitle>
            </SheetHeader>
            <div className="mt-2 grid grid-cols-3 gap-2 pb-4">
              {mobileOverflowNav.map((item) => {
                const badgeCount =
                  item.to === "/settings"
                    ? pendingCount
                    : item.to === "/manage"
                      ? manageBadgeCount
                      : 0;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className="relative flex flex-col items-center gap-1.5 rounded-xl border border-border px-2 py-3 text-xs text-foreground transition-colors hover:bg-accent [&.active]:border-primary [&.active]:text-primary"
                    activeProps={{ className: "active" }}
                    activeOptions={{ exact: true }}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                    {badgeCount > 0 && (
                      <span className="absolute right-2 top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
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
