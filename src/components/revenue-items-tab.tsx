import { useEffect, useMemo, useState } from "react";
import { Pencil, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { ClientLink } from "@/components/detail-panel";
import { fromDateKey, toDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";
import {
  REVENUE_KIND_LABELS,
  type RevenueKind,
  type WorkspaceRevenueItem,
  type WorkspaceRevenueItemInput,
} from "@/lib/workspace/types";

const NO_CLIENT_VALUE = "__none__";
const ALL_MONTHS = "all";

const formatDate = (key: string) =>
  fromDateKey(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const monthKeyOf = (dateKey: string) => dateKey.slice(0, 7);
const formatMonth = (monthKey: string) =>
  fromDateKey(`${monthKey}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

/**
 * 2026-10-16: one-off fees that aren't hours — recruitment & set-up fees for
 * now — entered by hand and added to Reports → Gross Profit's revenue. The
 * weekly sheet adds the same line ("Recruitment and Set Up Fee") to its
 * Gross Profit. Invoicing itself stays in Xero; this records the amount and
 * the date it counts towards.
 */
export function RevenueItemsTab() {
  const {
    canManage,
    clients,
    settings,
    revenueItems,
    createRevenueItem,
    updateRevenueItem,
    deleteRevenueItem,
  } = useWorkspace();

  const [month, setMonth] = useState(ALL_MONTHS);
  const [editing, setEditing] = useState<WorkspaceRevenueItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceRevenueItem | null>(null);
  const [busy, setBusy] = useState(false);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string | null) => (id === null ? "No client" : (map.get(id) ?? "Unknown client"));
  }, [clients]);

  // Months that have a fee, newest first, so the filter never offers an
  // empty month.
  const months = useMemo(
    () => [...new Set(revenueItems.map((r) => monthKeyOf(r.receivedOn)))].sort().reverse(),
    [revenueItems],
  );
  const shown = revenueItems.filter(
    (r) => month === ALL_MONTHS || monthKeyOf(r.receivedOn) === month,
  );
  const total = shown.reduce((sum, r) => sum + r.amount, 0);

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Fees and other revenue are only visible to people who manage the workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteRevenueItem(removing.id);
      toast.success("Fee removed");
      setRemoving(null);
    } catch (error) {
      toast.error("Couldn't remove", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-48" aria-label="Filter by month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MONTHS}>All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {formatMonth(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add fee
        </Button>
        <p className="text-xs text-muted-foreground">
          Recruitment and set-up fees, counted in Reports → Casual Profit on the date you give them.
          Invoices themselves stay in Xero.
        </p>
      </div>

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Date</th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Type</th>
                <th className="px-5 py-3 text-left font-medium">Note</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="w-24 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {revenueItems.length === 0
                      ? "No fees yet. Add one when a recruitment or set-up fee is charged."
                      : "No fees in that month."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-5 py-3">{formatDate(r.receivedOn)}</td>
                    <td className="px-5 py-3">
                      {r.clientId === null ? (
                        <span className="text-muted-foreground">No client</span>
                      ) : (
                        <ClientLink id={r.clientId}>{clientName(r.clientId)}</ClientLink>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {REVENUE_KIND_LABELS[r.kind]}
                    </td>
                    <td className="max-w-[18rem] truncate px-5 py-3 text-muted-foreground">
                      {r.note ?? ""}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">
                      {money(r.amount, settings.currency)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Edit fee of ${money(r.amount, settings.currency)} on ${formatDate(r.receivedOn)}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove fee of ${money(r.amount, settings.currency)} on ${formatDate(r.receivedOn)}`}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {shown.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-5 py-3 font-semibold" colSpan={4}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {money(total, settings.currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <RevenueItemDialog
        open={adding || editing !== null}
        item={editing}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        onSubmit={(input) =>
          editing ? updateRevenueItem(editing.id, input) : createRevenueItem(input)
        }
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this fee?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing &&
                `${money(removing.amount, settings.currency)} for ${clientName(removing.clientId)} on ${formatDate(removing.receivedOn)}. `}
              Gross Profit stops counting it, including in past periods. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog open until the delete resolves.
                e.preventDefault();
                void remove();
              }}
            >
              Remove fee
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RevenueItemDialog({
  open,
  item,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** The fee being edited, or null when adding. */
  item: WorkspaceRevenueItem | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: WorkspaceRevenueItemInput) => Promise<void>;
}) {
  const { clients, settings } = useWorkspace();
  const [receivedOn, setReceivedOn] = useState(toDateKey(new Date()));
  const [clientChoice, setClientChoice] = useState(NO_CLIENT_VALUE);
  const [kind, setKind] = useState<RevenueKind>("recruitment_setup");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReceivedOn(item?.receivedOn ?? toDateKey(new Date()));
    setClientChoice(item?.clientId ?? NO_CLIENT_VALUE);
    setKind(item?.kind ?? "recruitment_setup");
    setAmount(item ? String(item.amount) : "");
    setNote(item?.note ?? "");
  }, [open, item]);

  const parsedAmount = Number(amount.trim());
  const amountInvalid = amount.trim() !== "" && !(parsedAmount > 0);
  const canSubmit = !saving && !!receivedOn && amount.trim() !== "" && !amountInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({
        receivedOn,
        clientId: clientChoice === NO_CLIENT_VALUE ? null : clientChoice,
        kind,
        amount: parsedAmount,
        note: note.trim() || null,
      });
      toast.success(item ? "Fee updated" : "Fee added");
      onOpenChange(false);
    } catch (error) {
      toast.error(item ? "Couldn't save" : "Couldn't add fee", {
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit fee" : "Add a fee"}</DialogTitle>
          <DialogDescription>
            Counted in Gross Profit&apos;s revenue for the week and period that contain this date.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="revenue-date">Date</Label>
              <Input
                id="revenue-date"
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="revenue-amount">Amount ({settings.currency})</Label>
              <Input
                id="revenue-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                aria-invalid={amountInvalid}
                onChange={(e) => setAmount(e.target.value)}
              />
              {amountInvalid && <p className="text-xs text-destructive">More than zero.</p>}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="revenue-client">Client</Label>
            <Combobox
              id="revenue-client"
              options={[
                { value: NO_CLIENT_VALUE, label: "No client" },
                ...clients.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={clientChoice}
              onChange={setClientChoice}
              placeholder="Select a client…"
              searchPlaceholder="Search clients…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="revenue-kind">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as RevenueKind)}>
              <SelectTrigger id="revenue-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REVENUE_KIND_LABELS) as RevenueKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {REVENUE_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="revenue-note">Note (optional)</Label>
            <Input
              id="revenue-note"
              autoComplete="off"
              placeholder="e.g. invoice number, who it was for"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {item ? "Save fee" : "Add fee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
