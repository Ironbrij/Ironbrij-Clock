import { useEffect, useMemo, useState } from "react";
import { Trash2, Users } from "lucide-react";
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
import { useWorkspace, type WorkspacePlacement } from "@/lib/workspace-store";

const NEW_VA = "__new__";

const formatDate = (key: string) =>
  fromDateKey(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const money = (amount: number | null, currency: string) => {
  if (amount === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/**
 * M49: the management fee — derived, never stored, so it can't drift from
 * the two amounts it comes from. An unpriced side yields 0 rather than a
 * negative fee, matching what the source sheet shows for its "N/A" rows.
 */
export const managementFee = (p: {
  vaMonthlyRate: number | null;
  clientPackageAmount: number | null;
}): number =>
  p.vaMonthlyRate === null || p.clientPackageAmount === null
    ? 0
    : p.clientPackageAmount - p.vaMonthlyRate;

/**
 * M49: the admin editor for VA retainer placements — the "VA Package"
 * sheet. Lives in Manage for the same reason the Billing Rates and Casual
 * Service tabs do: Reports is read/export-only, Manage is where privileged
 * row-level actions live.
 *
 * Ending a placement sets its end date rather than deleting the row, so
 * the retainer accrual in past reports stays correct.
 */
export function PlacementsTab() {
  const {
    canManage,
    clients,
    settings,
    placements,
    placedVAs,
    createPlacement,
    updatePlacement,
    deletePlacement,
  } = useWorkspace();

  const [statusFilter, setStatusFilter] = useState<"active" | "ended" | "all">("active");
  const [adding, setAdding] = useState(false);

  const vaName = useMemo(() => {
    const map = new Map(placedVAs.map((v) => [v.id, v.fullName]));
    return (id: string) => map.get(id) ?? "Unknown VA";
  }, [placedVAs]);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Unknown client";
  }, [clients]);

  const rows = useMemo(
    () =>
      placements
        .filter((p) =>
          statusFilter === "all"
            ? true
            : statusFilter === "active"
              ? p.endedOn === null
              : p.endedOn !== null,
        )
        .map((p) => ({
          ...p,
          vaLabel: vaName(p.placedVaId),
          clientLabel: clientName(p.clientId),
          fee: managementFee(p),
        }))
        .sort(
          (a, b) =>
            a.vaLabel.localeCompare(b.vaLabel) || a.clientLabel.localeCompare(b.clientLabel),
        ),
    [placements, statusFilter, vaName, clientName],
  );

  const totalFee = rows.reduce((s, r) => s + r.fee, 0);

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            VA placements and retainer pricing are only visible to people who manage the workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add placement
        </Button>
        <p className="text-xs text-muted-foreground">
          Management fee is the package price minus what the VA is paid — calculated, not entered.
          Ending a placement keeps its history so past reports stay correct.
        </p>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">VA</th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Started</th>
                <th className="px-5 py-3 text-right font-medium">VA rate /mo</th>
                <th className="px-5 py-3 text-right font-medium">Package /mo</th>
                <th className="px-5 py-3 text-right font-medium">Management fee</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="w-12 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No placements in this filter.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <PlacementRow
                    key={r.id}
                    placement={r}
                    vaLabel={r.vaLabel}
                    clientLabel={r.clientLabel}
                    fee={r.fee}
                    currency={settings.currency}
                    onUpdate={updatePlacement}
                    onDelete={deletePlacement}
                  />
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold" colSpan={5}>
                    Total management fee /mo
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {money(totalFee, settings.currency)}
                  </td>
                  <td className="px-5 py-3" colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <AddPlacementDialog open={adding} onOpenChange={setAdding} onSubmit={createPlacement} />
    </div>
  );
}

function PlacementRow({
  placement,
  vaLabel,
  clientLabel,
  fee,
  currency,
  onUpdate,
  onDelete,
}: {
  placement: WorkspacePlacement;
  vaLabel: string;
  clientLabel: string;
  fee: number;
  currency: string;
  onUpdate: (
    id: string,
    patch: {
      endedOn?: string | null;
      vaMonthlyRate?: number | null;
      clientPackageAmount?: number | null;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(placement.vaMonthlyRate?.toString() ?? "");
  const [pkg, setPkg] = useState(placement.clientPackageAmount?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRate(placement.vaMonthlyRate?.toString() ?? "");
    setPkg(placement.clientPackageAmount?.toString() ?? "");
  }, [placement.vaMonthlyRate, placement.clientPackageAmount]);

  // Same shape as the hourly-rate field in Manage → Schedule: no-op when
  // unchanged, reject anything unparseable, revert local state on failure.
  const saveAmount = async (
    field: "vaMonthlyRate" | "clientPackageAmount",
    value: string,
    original: string,
    reset: (v: string) => void,
  ) => {
    if (value === original) return;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && (Number.isNaN(parsed) || (parsed ?? 0) < 0)) {
      toast.error("Amount must be a positive number");
      reset(original);
      return;
    }
    setBusy(true);
    try {
      await onUpdate(placement.id, { [field]: parsed });
    } catch (error) {
      toast.error("Couldn't save", { description: (error as Error).message });
      reset(original);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnded = async () => {
    setBusy(true);
    try {
      await onUpdate(placement.id, {
        endedOn: placement.endedOn === null ? toDateKey(new Date()) : null,
      });
      toast.success(placement.endedOn === null ? "Placement ended" : "Placement reopened");
    } catch (error) {
      toast.error("Couldn't update", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(placement.id);
      toast.success("Placement removed");
    } catch (error) {
      toast.error("Couldn't remove", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-5 py-3 font-medium">{vaLabel}</td>
      <td className="px-5 py-3">{clientLabel}</td>
      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
        {formatDate(placement.startedOn)}
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="N/A"
          value={rate}
          disabled={busy}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() =>
            void saveAmount(
              "vaMonthlyRate",
              rate,
              placement.vaMonthlyRate?.toString() ?? "",
              setRate,
            )
          }
          className="ml-auto h-8 w-28 text-right tabular-nums"
        />
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="N/A"
          value={pkg}
          disabled={busy}
          onChange={(e) => setPkg(e.target.value)}
          onBlur={() =>
            void saveAmount(
              "clientPackageAmount",
              pkg,
              placement.clientPackageAmount?.toString() ?? "",
              setPkg,
            )
          }
          className="ml-auto h-8 w-28 text-right tabular-nums"
        />
      </td>
      <td className="px-5 py-3 text-right font-semibold tabular-nums">{money(fee, currency)}</td>
      <td className="px-5 py-3">
        <button
          onClick={() => void toggleEnded()}
          disabled={busy}
          className="disabled:opacity-50"
          title={placement.endedOn === null ? "Mark as ended today" : "Reopen this placement"}
        >
          {placement.endedOn === null ? (
            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Ended {formatDate(placement.endedOn)}
            </Badge>
          )}
        </button>
      </td>
      <td className="px-5 py-3">
        <Button
          size="icon"
          variant="ghost"
          disabled={busy}
          aria-label="Remove placement"
          onClick={() => void remove()}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

function AddPlacementDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    placedVaId?: string;
    placedVaName?: string;
    clientId: string;
    startedOn: string;
    endedOn: string | null;
    vaMonthlyRate: number | null;
    clientPackageAmount: number | null;
  }) => Promise<void>;
}) {
  const { clients, placedVAs, settings } = useWorkspace();

  const [vaChoice, setVaChoice] = useState("");
  const [newVaName, setNewVaName] = useState("");
  const [clientId, setClientId] = useState("");
  const [startedOn, setStartedOn] = useState(toDateKey(new Date()));
  const [rate, setRate] = useState("");
  const [pkg, setPkg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVaChoice("");
    setNewVaName("");
    setClientId("");
    setStartedOn(toDateKey(new Date()));
    setRate("");
    setPkg("");
  }, [open]);

  const parse = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
  const rateInvalid = rate.trim() !== "" && Number.isNaN(Number(rate.trim()));
  const pkgInvalid = pkg.trim() !== "" && Number.isNaN(Number(pkg.trim()));
  const vaReady = vaChoice === NEW_VA ? newVaName.trim() !== "" : vaChoice !== "";
  const canSubmit = !saving && vaReady && !!clientId && !!startedOn && !rateInvalid && !pkgInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        placedVaId: vaChoice === NEW_VA ? undefined : vaChoice,
        placedVaName: vaChoice === NEW_VA ? newVaName.trim() : undefined,
        clientId,
        startedOn,
        endedOn: null,
        vaMonthlyRate: parse(rate),
        clientPackageAmount: parse(pkg),
      });
      toast.success("Placement added");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't add placement", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a placement</DialogTitle>
          <DialogDescription>
            A VA placed with a client on a monthly retainer. Leave an amount blank if that side
            isn&apos;t on a package — the management fee then reads zero rather than a negative.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="placement-va">VA</Label>
            <Combobox
              id="placement-va"
              options={[
                ...placedVAs.map((v) => ({ value: v.id, label: v.fullName })),
                { value: NEW_VA, label: "+ Add a new VA…" },
              ]}
              value={vaChoice}
              onChange={setVaChoice}
              placeholder="Select a VA…"
              searchPlaceholder="Search VAs…"
            />
            {vaChoice === NEW_VA && (
              <Input
                autoFocus
                placeholder="Full name"
                value={newVaName}
                onChange={(e) => setNewVaName(e.target.value)}
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="placement-client">Client</Label>
            <Combobox
              id="placement-client"
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Select a client…"
              searchPlaceholder="Search clients…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="placement-start">Started</Label>
              <Input
                id="placement-start"
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="placement-rate">VA rate /mo ({settings.currency})</Label>
              <Input
                id="placement-rate"
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="placement-pkg">Package /mo ({settings.currency})</Label>
              <Input
                id="placement-pkg"
                type="number"
                min="0"
                step="0.01"
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            Add placement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
