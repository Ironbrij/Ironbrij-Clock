import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, Mail } from "lucide-react";
import { formatCurrency } from "@/components/reports/report-config";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatHours } from "@/lib/mock-data";
import { managementFee, vaMonthlyCost } from "@/lib/retainer";
import {
  formatWeekRange,
  fromDateKey,
  isEmptyWeeklyScheduleDays,
  summarizeWeeklyScheduleDays,
  toDateKey,
} from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import { useClientBudgets, useWorkspace } from "@/lib/workspace-store";

/**
 * One side panel for "everything about this person" or "everything about this
 * client", opened by clicking their name. Before this, a person's role and
 * access lived in Settings → Users, their teams on Team, their schedule and
 * pay in Manage → Schedule and their rates in Billing; a client's details
 * were split across Projects → Clients and three Billing tabs.
 *
 * Read-only on purpose: every section links to the existing page that edits
 * it, so there's still exactly one place each value is changed. Sections a
 * viewer's role can't see (pay, rates, placements) are left out rather than
 * shown empty — and RLS wouldn't have loaded that data for them anyway.
 *
 * Mounted once per page by AppShell. A page change closes it.
 */

type Target = { kind: "person" | "client"; id: string } | null;
type DetailPanelApi = { openPerson: (id: string) => void; openClient: (id: string) => void };

const DetailPanelContext = createContext<DetailPanelApi | null>(null);

export function DetailPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target>(null);
  const api = useMemo<DetailPanelApi>(
    () => ({
      openPerson: (id) => setTarget({ kind: "person", id }),
      openClient: (id) => setTarget({ kind: "client", id }),
    }),
    [],
  );
  const close = () => setTarget(null);

  return (
    <DetailPanelContext.Provider value={api}>
      {children}
      <Sheet open={target !== null} onOpenChange={(open) => !open && close()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {target?.kind === "person" && <PersonDetail id={target.id} close={close} />}
          {target?.kind === "client" && <ClientDetail id={target.id} close={close} />}
        </SheetContent>
      </Sheet>
    </DetailPanelContext.Provider>
  );
}

const linkClass =
  "max-w-full truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A person's name that opens their panel. Plain text outside an AppShell. */
export function PersonLink({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useContext(DetailPanelContext);
  if (!panel) return <>{children}</>;
  return (
    <button
      type="button"
      className={cn(linkClass, className)}
      onClick={(e) => {
        // Names often sit inside clickable rows (expand, select).
        e.stopPropagation();
        panel.openPerson(id);
      }}
    >
      {children}
    </button>
  );
}

/** A client's name that opens their panel. Plain text outside an AppShell. */
export function ClientLink({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useContext(DetailPanelContext);
  if (!panel) return <>{children}</>;
  return (
    <button
      type="button"
      className={cn(linkClass, className)}
      onClick={(e) => {
        e.stopPropagation();
        panel.openClient(id);
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Style for the "Edit in …" links. Each closes the panel on click, so a
 * same-page link (another tab of this page) doesn't leave it open over the
 * result. Plain <Link> at each call site keeps TanStack's per-route search
 * typing.
 */
const editLinkClass =
  "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";
const editArrow = <ArrowRight className="h-3 w-3" aria-hidden="true" />;

const formatDate = (key: string) =>
  fromDateKey(key).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const STATUS_VARIANT = {
  Approved: "default",
  Submitted: "secondary",
  Rejected: "destructive",
} as const;

function PersonDetail({ id, close }: { id: string; close: () => void }) {
  const {
    memberById,
    teams,
    canManage,
    isAdmin,
    currentUser,
    employmentByUser,
    billingRates,
    clients,
    timesheets,
    settings,
  } = useWorkspace();
  const panel = useContext(DetailPanelContext);
  const member = memberById(id);

  if (!member) {
    return (
      <SheetHeader>
        <SheetTitle>Person not found</SheetTitle>
        <SheetDescription>
          They may have been removed, or you don&apos;t have access.
        </SheetDescription>
      </SheetHeader>
    );
  }

  const isSelf = member.id === currentUser.id;
  const memberTeams = teams.filter((t) => member.teamIds.includes(t.id));
  const employment = canManage ? employmentByUser.get(member.id) : undefined;
  const rates = canManage
    ? billingRates
        .filter((r) => r.userId === member.id)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    : [];
  const recentTimesheets =
    canManage || isSelf
      ? timesheets
          .filter((t) => t.userId === member.id)
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
          .slice(0, 6)
      : [];
  const clientName = (clientId: string) =>
    clients.find((c) => c.id === clientId)?.name ?? "Unknown client";
  const money = (n: number) => formatCurrency(n, settings.currency);

  const schedule = employment
    ? !isEmptyWeeklyScheduleDays(employment.weeklyScheduleDays)
      ? summarizeWeeklyScheduleDays(employment.weeklyScheduleDays)
      : employment.weeklySchedule || "Not set"
    : null;
  const pay = employment
    ? employment.weeklySalary !== null
      ? `${money(employment.weeklySalary)}/wk salary` +
        (employment.salaryFrom ? ` from ${formatDate(employment.salaryFrom)}` : "") +
        (employment.salaryTo ? ` to ${formatDate(employment.salaryTo)}` : "")
      : employment.hourlyRate !== null
        ? `${money(employment.hourlyRate)}/hr`
        : null
    : null;

  return (
    <div className="space-y-4">
      <SheetHeader className="space-y-3 text-left">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
            <AvatarFallback className="bg-secondary">{member.initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <SheetTitle className="truncate">{member.name}</SheetTitle>
            <SheetDescription className="truncate">{member.title || member.role}</SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{member.role}</Badge>
          {member.pending && <Badge variant="outline">Pending approval</Badge>}
          {!member.active && <Badge variant="outline">Removed</Badge>}
        </div>
      </SheetHeader>

      <Section title="Contact">
        <dl className="space-y-1.5">
          <Field label="Email">
            {member.email ? (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{member.email}</span>
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Timezone">{member.timezone}</Field>
          <Field label="Teams">
            {memberTeams.length > 0 ? memberTeams.map((t) => t.name).join(", ") : "No team yet"}
          </Field>
        </dl>
        {isAdmin && !isSelf && (
          <Link className={editLinkClass} to="/settings" search={{ tab: "users" }} onClick={close}>
            Role, teams and access in Settings → Users
            {editArrow}
          </Link>
        )}
      </Section>

      {canManage && (
        <Section title="Employment">
          {employment ? (
            <dl className="space-y-1.5">
              <Field label="Type">
                {employment.employmentType === "full_time" ? "Full-time" : "Part-time"}
              </Field>
              <Field label="Pay">
                {pay ?? (
                  <span className="text-amber-600 dark:text-amber-400">
                    No pay rate set — Gross Profit can&apos;t cost their hours
                  </span>
                )}
              </Field>
              <Field label="Schedule">{schedule}</Field>
            </dl>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No employment details yet, so Gross Profit can&apos;t cost their hours.
            </p>
          )}
          <Link className={editLinkClass} to="/manage" search={{ tab: "schedule" }} onClick={close}>
            Edit in Manage → Schedule
            {editArrow}
          </Link>
        </Section>
      )}

      {canManage && (
        <Section title="Client rates for their hours">
          {rates.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {rates.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3">
                  <button
                    type="button"
                    className={cn(linkClass, "min-w-0")}
                    onClick={() => panel?.openClient(r.clientId)}
                  >
                    {clientName(r.clientId)}
                  </button>
                  <span className="shrink-0 tabular-nums">
                    {money(r.hourlyRate)}/hr{" "}
                    <span className="text-muted-foreground">
                      from {formatDate(r.effectiveFrom)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No rates specific to them — each client&apos;s default rate applies.
            </p>
          )}
          <Link className={editLinkClass} to="/billing" search={{ tab: "rates" }} onClick={close}>
            Edit in Billing → Billing Rates
            {editArrow}
          </Link>
        </Section>
      )}

      {(canManage || isSelf) && (
        <Section title="Recent timesheets">
          {recentTimesheets.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {recentTimesheets.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  {canManage ? (
                    <Link
                      to="/manage"
                      search={{ tab: "entries", memberId: member.id, weekStart: t.weekStart }}
                      onClick={close}
                      className="truncate hover:underline"
                    >
                      {formatWeekRange(fromDateKey(t.weekStart))}
                    </Link>
                  ) : (
                    <span className="truncate">{formatWeekRange(fromDateKey(t.weekStart))}</span>
                  )}
                  <Badge
                    variant={
                      t.status in STATUS_VARIANT
                        ? STATUS_VARIANT[t.status as keyof typeof STATUS_VARIANT]
                        : "outline"
                    }
                  >
                    {t.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No timesheets in the last 400 days.</p>
          )}
        </Section>
      )}
    </div>
  );
}

function ClientDetail({ id, close }: { id: string; close: () => void }) {
  const {
    clients,
    projects,
    canManage,
    billingRates,
    memberById,
    placements,
    placedVAs,
    settings,
  } = useWorkspace();
  const budgets = useClientBudgets();
  const client = clients.find((c) => c.id === id);

  if (!client) {
    return (
      <SheetHeader>
        <SheetTitle>Client not found</SheetTitle>
        <SheetDescription>It may have been removed.</SheetDescription>
      </SheetHeader>
    );
  }

  const money = (n: number) => formatCurrency(n, settings.currency);
  const budget = budgets.get(client.id);
  const clientProjects = projects
    .filter((p) => p.clientId === client.id)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const today = toDateKey(new Date());
  const rates = canManage
    ? billingRates
        .filter((r) => r.clientId === client.id)
        .sort(
          (a, b) =>
            Number(a.userId !== null) - Number(b.userId !== null) ||
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        )
    : [];
  const clientPlacements = canManage
    ? placements
        .filter((p) => p.clientId === client.id)
        .sort((a, b) => Number(a.endedOn !== null) - Number(b.endedOn !== null))
    : [];
  const vaName = (placedVaId: string) =>
    placedVAs.find((v) => v.id === placedVaId)?.fullName ?? "Unknown VA";
  const liveFee = clientPlacements
    .filter((p) => p.endedOn === null)
    .reduce((sum, p) => sum + managementFee(p), 0);

  return (
    <div className="space-y-4">
      <SheetHeader className="space-y-2 text-left">
        <SheetTitle>{client.name}</SheetTitle>
        <SheetDescription>
          {client.contactName ? `Contact: ${client.contactName}` : "Client"}
        </SheetDescription>
        {!client.active && (
          <div>
            <Badge variant="outline">Inactive</Badge>
          </div>
        )}
      </SheetHeader>

      <Section title="Contact">
        <dl className="space-y-1.5">
          <Field label="Email">
            {client.contactEmail ? (
              <a
                href={`mailto:${client.contactEmail}`}
                className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{client.contactEmail}</span>
              </a>
            ) : (
              <span className="text-muted-foreground">
                No contact email — reports can&apos;t be emailed
              </span>
            )}
          </Field>
          <Field label="Basecamp">
            {client.basecampUrl ? (
              <a
                href={client.basecampUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Subscription">
            {budget ? (
              <span
                className={
                  budget.isOver
                    ? "font-medium text-destructive"
                    : budget.isNearLimit
                      ? "font-medium text-amber-600 dark:text-amber-400"
                      : undefined
                }
              >
                {budget.isOver
                  ? `Over by ${formatHours(-budget.remainingHours)}`
                  : `${formatHours(budget.remainingHours)} left`}{" "}
                <span className="font-normal text-muted-foreground">
                  of {formatHours(budget.subscriptionHours)}
                </span>
              </span>
            ) : (
              "No hours cap"
            )}
          </Field>
        </dl>
        <Link className={editLinkClass} to="/projects" search={{ tab: "clients" }} onClick={close}>
          Edit in Projects → Clients
          {editArrow}
        </Link>
      </Section>

      <Section title={`Projects (${clientProjects.length})`}>
        {clientProjects.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {clientProjects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                    aria-hidden="true"
                  />
                  <span className={cn("truncate", p.archived && "text-muted-foreground")}>
                    {p.name}
                    {p.archived ? " (archived)" : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatHours(p.hours)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No projects for this client.</p>
        )}
      </Section>

      {canManage && (
        <Section title="Billing rates">
          {rates.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {rates.map((r) => {
                const member = r.userId ? memberById(r.userId) : undefined;
                return (
                  <li key={r.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {r.userId === null ? (
                        "Default"
                      ) : member ? (
                        <PersonLink id={member.id}>{member.name}</PersonLink>
                      ) : (
                        "Unknown person"
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {money(r.hourlyRate)}/hr{" "}
                      <span className="text-muted-foreground">
                        {r.effectiveFrom > today ? "starts" : "from"} {formatDate(r.effectiveFrom)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No billing rate — Gross Profit can&apos;t price this client&apos;s hours.
            </p>
          )}
          <Link className={editLinkClass} to="/billing" search={{ tab: "rates" }} onClick={close}>
            Edit in Billing → Billing Rates
            {editArrow}
          </Link>
        </Section>
      )}

      {canManage && (
        <Section title="Placements">
          {clientPlacements.length > 0 ? (
            <>
              <ul className="space-y-2 text-sm">
                {clientPlacements.map((p) => {
                  const cost = vaMonthlyCost(p);
                  return (
                    <li key={p.id} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{vaName(p.placedVaId)}</span>
                        <Badge variant="outline" className="shrink-0">
                          {p.endedOn === null ? "Active" : `Ended ${formatDate(p.endedOn)}`}
                        </Badge>
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {p.vaHourlyRate !== null ? `${money(p.vaHourlyRate)}/hr` : "Rate N/A"}
                        {p.contractedWeeklyHours !== null
                          ? ` × ${p.contractedWeeklyHours} h/wk`
                          : ""}
                        {cost !== null ? ` = ${money(cost)}/mo` : ""}
                        {" · "}package{" "}
                        {p.clientPackageAmount !== null
                          ? `${money(p.clientPackageAmount)}/mo`
                          : "N/A"}
                        {" · "}fee {money(managementFee(p))}/mo
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm">
                Live management fee:{" "}
                <span className="font-semibold tabular-nums">{money(liveFee)}/mo</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No VA placements with this client.</p>
          )}
          <Link
            className={editLinkClass}
            to="/billing"
            search={{ tab: "placements" }}
            onClick={close}
          >
            Edit in Billing → Placements
            {editArrow}
          </Link>
        </Section>
      )}
    </div>
  );
}
