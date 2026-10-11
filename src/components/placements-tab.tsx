import { useEffect, useMemo, useState } from "react";
import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { managementFee, vaMonthlyCost } from "@/lib/retainer";
import { fromDateKey, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type WorkspacePlacement } from "@/lib/workspace-store";
import { ClientLink } from "@/components/detail-panel";

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
 * A stored amount as an input's starting text. The hourly rate is stored to
 * six decimals (converted placements keep their exact monthly cost), but is
 * shown and compared at two, so blurring an untouched field never rewrites it.
 */
const asInput = (n: number | null) => (n === null ? "" : String(Math.round(n * 100) / 100));

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
          <SelectTrigger className="w-40" aria-label="Filter by status">
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
          VA cost /mo is the hourly rate × weekly hours × 52 ÷ 12, and the management fee is the
          package minus that — both calculated, not entered. Ending a placement keeps its history so
          past reports stay correct.
        </p>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">VA</th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Started</th>
                <th className="px-5 py-3 text-right font-medium">VA rate /hr</th>
                <th className="px-5 py-3 text-right font-medium">Hours /wk</th>
                <th className="px-5 py-3 text-right font-medium">VA cost /mo</th>
                <th className="px-5 py-3 text-right font-medium">Package /mo</th>
                <th className="px-5 py-3 text-right font-medium">Management fee</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="w-12 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-sm text-muted-foreground">
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
                  <td className="px-5 py-3 font-semibold" colSpan={7}>
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
      vaHourlyRate?: number | null;
      contractedWeeklyHours?: number | null;
      clientPackageAmount?: number | null;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(asInput(placement.vaHourlyRate));
  const [hours, setHours] = useState(asInput(placement.contractedWeeklyHours));
  const [pkg, setPkg] = useState(placement.clientPackageAmount?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    setRate(asInput(placement.vaHourlyRate));
    setHours(asInput(placement.contractedWeeklyHours));
    setPkg(placement.clientPackageAmount?.toString() ?? "");
  }, [placement.vaHourlyRate, placement.contractedWeeklyHours, placement.clientPackageAmount]);

  // Same shape as the hourly-rate field in Manage → Schedule: no-op when
  // unchanged, reject anything unparseable, revert local state on failure.
  const saveAmount = async (
    field: "vaHourlyRate" | "contractedWeeklyHours" | "clientPackageAmount",
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
    // Same bounds as the column's CHECK constraint.
    if (field === "contractedWeeklyHours" && parsed !== null && (parsed <= 0 || parsed > 168)) {
      toast.error("Weekly hours must be more than 0 and at most 168");
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
    // The badge is a one-click toggle, so the toast carries an Undo that
    // puts back exactly the end date that was there before (null or a date).
    const previousEndedOn = placement.endedOn;
    setBusy(true);
    try {
      await onUpdate(placement.id, {
        endedOn: previousEndedOn === null ? toDateKey(new Date()) : null,
      });
      toast.success(previousEndedOn === null ? "Placement ended" : "Placement reopened", {
        action: {
          label: "Undo",
          onClick: () => {
            onUpdate(placement.id, { endedOn: previousEndedOn }).catch((error: Error) =>
              toast.error("Couldn't undo that", { description: error.message }),
            );
          },
        },
      });
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
      setConfirmingRemove(false);
    } catch (error) {
      toast.error("Couldn't remove", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-5 py-3 font-medium">{vaLabel}</td>
      <td className="px-5 py-3">
        <ClientLink id={placement.clientId}>{clientLabel}</ClientLink>
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
        {formatDate(placement.startedOn)}
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="N/A"
          aria-label={`VA hourly rate for ${vaLabel} at ${clientLabel}`}
          value={rate}
          disabled={busy}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() =>
            void saveAmount("vaHourlyRate", rate, asInput(placement.vaHourlyRate), setRate)
          }
          className="ml-auto h-8 w-24 text-right tabular-nums"
        />
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0.25"
          max="168"
          step="0.25"
          placeholder="N/A"
          aria-label={`Contracted hours per week for ${vaLabel} at ${clientLabel}`}
          value={hours}
          disabled={busy}
          onChange={(e) => setHours(e.target.value)}
          onBlur={() =>
            void saveAmount(
              "contractedWeeklyHours",
              hours,
              asInput(placement.contractedWeeklyHours),
              setHours,
            )
          }
          className="ml-auto h-8 w-20 text-right tabular-nums"
        />
      </td>
      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
        {money(vaMonthlyCost(placement), currency)}
      </td>
      <td className="px-5 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="N/A"
          aria-label={`Monthly package for ${vaLabel} at ${clientLabel}`}
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
          type="button"
          onClick={() => void toggleEnded()}
          disabled={busy}
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          title={placement.endedOn === null ? "Mark as ended today" : "Reopen this placement"}
          aria-label={
            placement.endedOn === null
              ? `Active — mark ${vaLabel} at ${clientLabel} as ended today`
              : `Ended ${formatDate(placement.endedOn)} — reopen ${vaLabel} at ${clientLabel}`
          }
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
          aria-label={`Remove placement: ${vaLabel} at ${clientLabel}`}
          onClick={() => setConfirmingRemove(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
        <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {vaLabel} at {clientLabel}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the placement and its history, so past retainer reports will no longer
                include it. If the placement has just finished, end it instead — click its Active
                badge — which keeps past reports correct. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(e) => {
                  // Keep the dialog open until the delete resolves, so a
                  // failure is shown against it rather than after it closes.
                  e.preventDefault();
                  void remove();
                }}
              >
                Remove placement
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
    vaHourlyRate: number | null;
    contractedWeeklyHours: number | null;
    clientPackageAmount: number | null;
  }) => Promise<void>;
}) {
  const { clients, placedVAs, settings } = useWorkspace();

  const [vaChoice, setVaChoice] = useState("");
  const [newVaName, setNewVaName] = useState("");
  const [clientId, setClientId] = useState("");
  const [startedOn, setStartedOn] = useState(toDateKey(new Date()));
  const [rate, setRate] = useState("");
  const [hours, setHours] = useState("40");
  const [pkg, setPkg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVaChoice("");
    setNewVaName("");
    setClientId("");
    setStartedOn(toDateKey(new Date()));
    setRate("");
    setHours("40");
    setPkg("");
  }, [open]);

  const parse = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
  const rateInvalid = rate.trim() !== "" && Number.isNaN(Number(rate.trim()));
  const pkgInvalid = pkg.trim() !== "" && Number.isNaN(Number(pkg.trim()));
  const hoursValue = parse(hours);
  const hoursInvalid =
    hoursValue !== null && (Number.isNaN(hoursValue) || hoursValue <= 0 || hoursValue > 168);
  const previewCost =
    rateInvalid || hoursInvalid
      ? null
      : vaMonthlyCost({ vaHourlyRate: parse(rate), contractedWeeklyHours: hoursValue });
  const previewPackage = pkgInvalid ? null : parse(pkg);
  const vaReady = vaChoice === NEW_VA ? newVaName.trim() !== "" : vaChoice !== "";
  const canSubmit =
    !saving && vaReady && !!clientId && !!startedOn && !rateInvalid && !hoursInvalid && !pkgInvalid;

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
        vaHourlyRate: parse(rate),
        contractedWeeklyHours: hoursValue,
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
            A VA placed with a client: the VA is paid by the hour for their contracted weekly hours,
            and the client pays a monthly package. Leave an amount blank if that side isn&apos;t
            priced — the management fee then reads zero rather than a negative.
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
                aria-label="New VA full name"
                autoComplete="off"
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

          <div className="grid gap-4 sm:grid-cols-2">
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
              <Label htmlFor="placement-rate">VA rate /hr ({settings.currency})</Label>
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
              <Label htmlFor="placement-hours">Hours /wk</Label>
              <Input
                id="placement-hours"
                type="number"
                min="0.25"
                max="168"
                step="0.25"
                value={hours}
                aria-invalid={hoursInvalid}
                onChange={(e) => setHours(e.target.value)}
              />
              {hoursInvalid && (
                <p className="text-xs text-destructive">More than 0 and at most 168.</p>
              )}
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
          {previewCost !== null && (
            <p className="text-xs text-muted-foreground">
              VA cost ≈ {money(previewCost, settings.currency)} /mo
              {previewPackage !== null &&
                ` · management fee ≈ ${money(previewPackage - previewCost, settings.currency)} /mo`}
            </p>
          )}
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
