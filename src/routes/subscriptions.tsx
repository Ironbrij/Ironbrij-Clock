import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, ProjectDot } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { monthlyEquivalent, monthlyTotalsByCurrency } from "@/lib/subscriptions";
import { fromDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";
import {
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_CYCLE_LABELS,
  type SubscriptionCategory,
  type SubscriptionCycle,
  type SubscriptionStatus,
  type WorkspaceSubscription,
  type WorkspaceSubscriptionInput,
} from "@/lib/workspace/types";

const CATEGORIES = Object.keys(SUBSCRIPTION_CATEGORY_LABELS) as SubscriptionCategory[];
const isCategory = (v: unknown): v is SubscriptionCategory =>
  CATEGORIES.includes(v as SubscriptionCategory);
const NO_TEAM = "__none__";
/** The "All departments" choice: used by every department, shown as its own spend line. */
const ALL_TEAMS = "__all__";

export const Route = createFileRoute("/subscriptions")({
  // The first tab stays out of the URL, the same as Billing and Manage.
  validateSearch: (search: Record<string, unknown>): { tab?: SubscriptionCategory } => ({
    tab: isCategory(search.tab) && search.tab !== CATEGORIES[0] ? search.tab : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Subscriptions — IronTrack" },
      {
        name: "description",
        content:
          "Software subscriptions — AI tools, editing tools and the rest — and who uses them.",
      },
      { property: "og:title", content: "Subscriptions — IronTrack" },
      { property: "og:description", content: "What the company pays for software, by department." },
    ],
  }),
  component: SubscriptionsPage,
});

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const formatDate = (key: string) =>
  fromDateKey(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const totalsText = (totals: { currency: string; amount: number }[]) =>
  totals.length === 0 ? "—" : totals.map((t) => money(t.amount, t.currency)).join(" + ");

/**
 * 2026-10-16: what the company pays for software, in three tabs — AI tools,
 * editing tools, everything else — with the department (team) that uses each
 * one, so spend can be tracked and allocated. Managers and admins only.
 * Each subscription keeps its own currency and totals never mix currencies.
 */
function SubscriptionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: SubscriptionCategory = search.tab ?? CATEGORIES[0];
  const {
    canManage,
    teams,
    subscriptions,
    createSubscription,
    updateSubscription,
    deleteSubscription,
  } = useWorkspace();

  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "all">("active");
  const [editing, setEditing] = useState<WorkspaceSubscription | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceSubscription | null>(null);
  const [busy, setBusy] = useState(false);

  const team = useMemo(() => {
    const map = new Map(teams.map((t) => [t.id, t]));
    return (id: string | null) => (id === null ? undefined : map.get(id));
  }, [teams]);

  const shown = subscriptions
    .filter((s) => s.category === tab)
    .filter((s) => statusFilter === "all" || s.status === statusFilter);

  // Spend by department across every tab: active subscriptions only.
  const byDepartment = useMemo(() => {
    const groups = new Map<string, WorkspaceSubscription[]>();
    for (const s of subscriptions) {
      if (s.status !== "active") continue;
      const key = s.allDepartments ? ALL_TEAMS : (s.teamId ?? NO_TEAM);
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return (
      [...groups.entries()]
        .map(([key, subs]) => ({
          key,
          all: key === ALL_TEAMS,
          team: key === NO_TEAM || key === ALL_TEAMS ? undefined : team(key),
          count: subs.length,
          totals: monthlyTotalsByCurrency(subs),
        }))
        // All departments first, then the teams, then "No department".
        .sort(
          (a, b) =>
            Number(b.all) - Number(a.all) ||
            (a.team?.name ?? "~").localeCompare(b.team?.name ?? "~"),
        )
    );
  }, [subscriptions, team]);

  if (!canManage) {
    return (
      <AppShell title="Subscriptions" subtitle="Software the company pays for.">
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Boxes className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="text-lg font-semibold">Managers and admins only</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Subscriptions and what they cost are only visible to people who manage the workspace.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteSubscription(removing.id);
      toast.success("Subscription removed");
      setRemoving(null);
    } catch (error) {
      toast.error("Couldn't remove", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Subscriptions"
      subtitle="Software the company pays for, and which department uses it."
      actions={<Button onClick={() => setAdding(true)}>Add subscription</Button>}
    >
      <Card className="mb-6 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Monthly spend by department — active subscriptions, all tabs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {byDepartment.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No active subscriptions yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {byDepartment.map((d) => (
                <li
                  key={d.key}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-2"
                >
                  <span className="flex items-center gap-2">
                    {d.team ? <ProjectDot color={d.team.color} /> : null}
                    {d.all ? "All departments" : (d.team?.name ?? "No department")}
                    <span className="text-xs text-muted-foreground">
                      {d.count} {d.count === 1 ? "subscription" : "subscriptions"}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{totalsText(d.totals)} /mo</span>
                </li>
              ))}
              <li className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-5 py-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {totalsText(monthlyTotalsByCurrency(subscriptions))} /mo
                </span>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) =>
            void navigate({
              search: {
                tab: value === CATEGORIES[0] ? undefined : (value as SubscriptionCategory),
              },
              replace: true,
            })
          }
        >
          <TabsList className="h-auto flex-wrap justify-start gap-1">
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c}>
                {SUBSCRIPTION_CATEGORY_LABELS[c]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as SubscriptionStatus | "all")}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Department</th>
                <th className="px-5 py-3 text-right font-medium">Cost</th>
                <th className="px-5 py-3 text-right font-medium">Per month</th>
                <th className="px-5 py-3 text-left font-medium">Renews</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="w-24 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No {statusFilter === "all" ? "" : `${statusFilter} `}
                    {SUBSCRIPTION_CATEGORY_LABELS[tab].toLowerCase()} yet.
                  </td>
                </tr>
              ) : (
                shown.map((s) => {
                  const t = team(s.teamId);
                  const monthly = monthlyEquivalent(s);
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium">{s.name}</div>
                        {s.notes && (
                          <div className="max-w-[18rem] truncate text-xs text-muted-foreground">
                            {s.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          {t ? <ProjectDot color={t.color} /> : null}
                          {s.allDepartments
                            ? "All departments"
                            : (t?.name ?? (
                                <span className="text-muted-foreground">No department</span>
                              ))}
                        </span>
                        {s.departmentNote && (
                          <div className="text-xs text-muted-foreground">{s.departmentNote}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                        {s.amount === null ? "—" : money(s.amount, s.currency)}
                        <span className="text-muted-foreground">
                          {" "}
                          / {SUBSCRIPTION_CYCLE_LABELS[s.billingCycle].toLowerCase()}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                        {monthly === null ? "—" : money(monthly, s.currency)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {s.renewsOn ? formatDate(s.renewsOn) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          variant="outline"
                          className={
                            s.status === "active"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                          }
                        >
                          {s.status === "active" ? "Active" : "Cancelled"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${s.name}`}
                            onClick={() => setEditing(s)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${s.name}`}
                            onClick={() => setRemoving(s)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {shown.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold" colSpan={3}>
                    Active, per month
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums">
                    {totalsText(monthlyTotalsByCurrency(shown))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        Per month is the cost of a monthly plan, or a twelfth of an annual one. &ldquo;Other&rdquo;
        cycles and cancelled subscriptions aren&apos;t counted. Different currencies are shown
        separately rather than converted.
      </p>

      <SubscriptionDialog
        open={adding || editing !== null}
        subscription={editing}
        defaultCategory={tab}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        onSubmit={(input) =>
          editing ? updateSubscription(editing.id, input) : createSubscription(input)
        }
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes it from the list. If it&apos;s just been cancelled, edit it and set its
              status to Cancelled instead, which keeps the record. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Remove subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function SubscriptionDialog({
  open,
  subscription,
  defaultCategory,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** The subscription being edited, or null when adding. */
  subscription: WorkspaceSubscription | null;
  /** The tab the page is on, used as the category for a new one. */
  defaultCategory: SubscriptionCategory;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: WorkspaceSubscriptionInput) => Promise<void>;
}) {
  const { teams, settings } = useWorkspace();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SubscriptionCategory>(defaultCategory);
  const [teamChoice, setTeamChoice] = useState(NO_TEAM);
  const [departmentNote, setDepartmentNote] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(settings.currency);
  const [cycle, setCycle] = useState<SubscriptionCycle>("monthly");
  const [renewsOn, setRenewsOn] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus>("active");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(subscription?.name ?? "");
    setCategory(subscription?.category ?? defaultCategory);
    setTeamChoice(subscription?.allDepartments ? ALL_TEAMS : (subscription?.teamId ?? NO_TEAM));
    setDepartmentNote(subscription?.departmentNote ?? "");
    setAmount(subscription?.amount != null ? String(subscription.amount) : "");
    setCurrency(subscription?.currency ?? settings.currency);
    setCycle(subscription?.billingCycle ?? "monthly");
    setRenewsOn(subscription?.renewsOn ?? "");
    setStatus(subscription?.status ?? "active");
    setNotes(subscription?.notes ?? "");
  }, [open, subscription, defaultCategory, settings.currency]);

  const amountValue = amount.trim() === "" ? null : Number(amount.trim());
  const amountInvalid = amountValue !== null && !(amountValue >= 0);
  const currencyInvalid = !/^[A-Za-z]{3}$/.test(currency.trim());
  const canSubmit = !saving && name.trim() !== "" && !amountInvalid && !currencyInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        name,
        category,
        teamId: teamChoice === NO_TEAM || teamChoice === ALL_TEAMS ? null : teamChoice,
        allDepartments: teamChoice === ALL_TEAMS,
        departmentNote: departmentNote || null,
        amount: amountValue,
        currency: currency.trim().toUpperCase(),
        billingCycle: cycle,
        renewsOn: renewsOn || null,
        status,
        notes: notes || null,
      });
      toast.success(subscription ? "Subscription updated" : "Subscription added");
      onOpenChange(false);
    } catch (error) {
      toast.error(subscription ? "Couldn't save" : "Couldn't add subscription", {
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{subscription ? "Edit subscription" : "Add a subscription"}</DialogTitle>
          <DialogDescription>
            What it costs, how often it&apos;s billed, and which department uses it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="sub-name">Name</Label>
            <Input
              id="sub-name"
              autoComplete="off"
              placeholder="e.g. ChatGPT Team"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sub-category">Tab</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as SubscriptionCategory)}
              >
                <SelectTrigger id="sub-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {SUBSCRIPTION_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-team">Department</Label>
              <Select value={teamChoice} onValueChange={setTeamChoice}>
                <SelectTrigger id="sub-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TEAMS}>All departments</SelectItem>
                  <SelectItem value={NO_TEAM}>No department</SelectItem>
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
            <Label htmlFor="sub-dept-note">Department note (optional)</Label>
            <Input
              id="sub-dept-note"
              autoComplete="off"
              placeholder="e.g. shared with Marketing"
              value={departmentNote}
              onChange={(e) => setDepartmentNote(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="sub-amount">Cost</Label>
              <Input
                id="sub-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                aria-invalid={amountInvalid}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-currency">Currency</Label>
              <Input
                id="sub-currency"
                autoComplete="off"
                maxLength={3}
                value={currency}
                aria-invalid={currencyInvalid}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-cycle">Billed</Label>
              <Select value={cycle} onValueChange={(v) => setCycle(v as SubscriptionCycle)}>
                <SelectTrigger id="sub-cycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SUBSCRIPTION_CYCLE_LABELS) as SubscriptionCycle[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {SUBSCRIPTION_CYCLE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {currencyInvalid && (
            <p className="text-xs text-destructive">Currency must be a 3-letter code, like USD.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sub-renews">Renews on (optional)</Label>
              <Input
                id="sub-renews"
                type="date"
                value={renewsOn}
                onChange={(e) => setRenewsOn(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)}>
                <SelectTrigger id="sub-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sub-notes">Notes (optional)</Label>
            <Input
              id="sub-notes"
              autoComplete="off"
              placeholder="e.g. seats, login owner"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {subscription ? "Save subscription" : "Add subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
