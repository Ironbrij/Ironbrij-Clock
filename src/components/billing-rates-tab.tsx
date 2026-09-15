import { useEffect, useMemo, useState } from "react";
import { Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/combobox";
import { fromDateKey, toDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";

const CLIENT_DEFAULT = "__default__";

const formatDate = (key: string) =>
  fromDateKey(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * M48: the admin editor for client invoice rates — what a client is
 * charged per hour, the one input Gross Profit reporting needs that
 * IronTrack never stored before.
 *
 * Lives in Manage rather than Reports for the same reason CasualServiceTab
 * does: Reports is read/export-only, Manage is where privileged row-level
 * actions live.
 *
 * Rates are effective-dated, so "changing" a rate means adding a new row
 * with a later start date — the old row stays, and last month's report
 * keeps showing last month's rate. Editing a row in place is for
 * correcting a typo, not for repricing.
 */
export function BillingRatesTab() {
  const {
    canManage,
    clients,
    members,
    settings,
    billingRates,
    createBillingRate,
    updateBillingRate,
    deleteBillingRate,
  } = useWorkspace();

  const [clientFilter, setClientFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Unknown client";
  }, [clients]);

  const memberName = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.name]));
    return (id: string) => map.get(id) ?? "Former member";
  }, [members]);

  const rows = useMemo(
    () =>
      billingRates
        .filter((r) => clientFilter === "all" || r.clientId === clientFilter)
        .map((r) => ({
          ...r,
          clientLabel: clientName(r.clientId),
          scopeLabel: r.userId === null ? "All VAs (default)" : memberName(r.userId),
        }))
        .sort(
          (a, b) =>
            a.clientLabel.localeCompare(b.clientLabel) ||
            // Client default first, then VA overrides by name.
            Number(a.userId !== null) - Number(b.userId !== null) ||
            a.scopeLabel.localeCompare(b.scopeLabel) ||
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        ),
    [billingRates, clientFilter, clientName, memberName],
  );

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Client billing rates are only visible to people who manage the workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Combobox
          options={[
            { value: "all", label: "All clients" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]}
          value={clientFilter}
          onChange={setClientFilter}
          searchPlaceholder="Search clients…"
          triggerClassName="w-56"
        />
        <Button size="sm" onClick={() => setAdding(true)}>
          Add rate
        </Button>
        <p className="text-xs text-muted-foreground">
          A rate for a specific VA overrides the client&apos;s default. Changing a price means
          adding a new rate with a later start date — earlier reports keep the rate that applied
          then.
        </p>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Applies to</th>
                <th className="px-5 py-3 text-right font-medium">Rate ({settings.currency}/hr)</th>
                <th className="px-5 py-3 text-left font-medium">Effective from</th>
                <th className="w-12 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No billing rates set yet. Add one to start reporting gross profit.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <RateRow
                    key={r.id}
                    id={r.id}
                    clientLabel={r.clientLabel}
                    scopeLabel={r.scopeLabel}
                    isOverride={r.userId !== null}
                    hourlyRate={r.hourlyRate}
                    effectiveFrom={r.effectiveFrom}
                    onSave={updateBillingRate}
                    onDelete={deleteBillingRate}
                  />
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddRateDialog open={adding} onOpenChange={setAdding} onSubmit={createBillingRate} />
    </div>
  );
}

function RateRow({
  id,
  clientLabel,
  scopeLabel,
  isOverride,
  hourlyRate,
  effectiveFrom,
  onSave,
  onDelete,
}: {
  id: string;
  clientLabel: string;
  scopeLabel: string;
  isOverride: boolean;
  hourlyRate: number;
  effectiveFrom: string;
  onSave: (id: string, hourlyRate: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(String(hourlyRate));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRate(String(hourlyRate));
  }, [hourlyRate]);

  // Same shape as the hourly-rate field in Manage → Schedule: no-op when
  // unchanged, reject anything unparseable, revert local state on failure.
  const save = async () => {
    const original = String(hourlyRate);
    if (rate === original) return;
    const parsed = Number(rate.trim());
    if (!rate.trim() || Number.isNaN(parsed) || parsed < 0) {
      toast.error("Rate must be a positive number");
      setRate(original);
      return;
    }
    setBusy(true);
    try {
      await onSave(id, parsed);
      toast.success("Rate updated");
    } catch (error) {
      toast.error("Couldn't save rate", { description: (error as Error).message });
      setRate(original);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(id);
      toast.success("Rate removed");
    } catch (error) {
      toast.error("Couldn't remove rate", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-5 py-3 font-medium">{clientLabel}</td>
      <td className="px-5 py-3">
        {isOverride ? (
          <Badge variant="outline">{scopeLabel}</Badge>
        ) : (
          <span className="text-muted-foreground">{scopeLabel}</span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={rate}
          disabled={busy}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => void save()}
          className="ml-auto h-8 w-28 text-right tabular-nums"
        />
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
        {formatDate(effectiveFrom)}
      </td>
      <td className="px-5 py-3">
        <Button
          size="icon"
          variant="ghost"
          disabled={busy}
          aria-label="Remove rate"
          onClick={() => void remove()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

function AddRateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    clientId: string;
    userId: string | null;
    hourlyRate: number;
    effectiveFrom: string;
  }) => Promise<void>;
}) {
  const { clients, members, settings } = useWorkspace();
  const todayKey = toDateKey(new Date());

  const [clientId, setClientId] = useState("");
  const [scope, setScope] = useState(CLIENT_DEFAULT);
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setScope(CLIENT_DEFAULT);
    setRate("");
    setEffectiveFrom(toDateKey(new Date()));
  }, [open]);

  const parsedRate = Number(rate.trim());
  const rateInvalid = rate.trim() !== "" && (Number.isNaN(parsedRate) || parsedRate < 0);
  const canSubmit = !saving && !!clientId && rate.trim() !== "" && !rateInvalid && !!effectiveFrom;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        clientId,
        userId: scope === CLIENT_DEFAULT ? null : scope,
        hourlyRate: parsedRate,
        effectiveFrom,
      });
      toast.success("Rate added");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't add rate", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a billing rate</DialogTitle>
          <DialogDescription>
            What this client is charged per hour. Leave &quot;applies to&quot; on the default unless
            a particular VA is billed at a different rate for this client.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rate-client">Client</Label>
            <Combobox
              id="rate-client"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Select a client…"
              searchPlaceholder="Search clients…"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rate-scope">Applies to</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="rate-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CLIENT_DEFAULT}>All VAs (default)</SelectItem>
                {members
                  .filter((m) => !m.pending)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="rate-amount">Rate ({settings.currency}/hr)</Label>
              <Input
                id="rate-amount"
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              {rateInvalid && (
                <p className="text-xs text-destructive">Rate must be a positive number.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rate-from">Effective from</Label>
              <Input
                id="rate-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            Add rate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
