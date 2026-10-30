import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatCurrency } from "@/components/reports/report-config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { PAY_FROM_THE_START, payChangeOn, type PayRateRow } from "@/lib/pay-rates";
import { fromDateKey, toDateKey } from "@/lib/time-utils";
import { useWorkspace } from "@/lib/workspace-store";

type PayKind = "hourly" | "salary" | "none";

const formatDay = (date: string) =>
  date === PAY_FROM_THE_START
    ? "From the start"
    : fromDateKey(date).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

const kindOf = (r: Pick<PayRateRow, "hourlyRate" | "weeklySalary"> | null): PayKind =>
  r?.weeklySalary != null ? "salary" : r?.hourlyRate != null ? "hourly" : "none";

function payText(r: Pick<PayRateRow, "hourlyRate" | "weeklySalary">, currency: string) {
  if (r.weeklySalary !== null) return `${formatCurrency(r.weeklySalary, currency)}/wk salary`;
  if (r.hourlyRate !== null) return `${formatCurrency(r.hourlyRate, currency)}/hr`;
  return "No pay";
}

/**
 * Manage → Schedule's Pay cell (2026-10-30): today's pay, since when, any
 * change already booked for later, and the button into the history.
 */
export function PayCell({ member }: { member: { id: string; name: string } }) {
  const { payHistoryByUser, settings } = useWorkspace();
  const [open, setOpen] = useState(false);
  const history = payHistoryByUser.get(member.id) ?? [];
  const today = toDateKey(new Date());
  const current = payChangeOn(history, today);
  const next = history.find((r) => r.effectiveFrom > today);

  return (
    <div className="flex min-w-48 items-start justify-between gap-2">
      <div className="text-sm">
        {current && kindOf(current) !== "none" ? (
          <>
            <p className="font-medium tabular-nums">{payText(current, settings.currency)}</p>
            {current.effectiveFrom !== PAY_FROM_THE_START && (
              <p className="text-xs text-muted-foreground">
                since {formatDay(current.effectiveFrom)}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No pay set</p>
        )}
        {next && (
          <p className="text-xs text-muted-foreground">
            {payText(next, settings.currency)} from {formatDay(next.effectiveFrom)}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0"
        aria-label={`Change pay for ${member.name}`}
        onClick={() => setOpen(true)}
      >
        Change pay…
      </Button>
      <PayHistoryDialog member={member} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Someone's pay history and a form to add a change from a date. Work before
 * the date keeps the old pay; a change on a date that already has one
 * replaces it. "No pay" is how a leaver's salary stops.
 */
export function PayHistoryDialog({
  member,
  open,
  onOpenChange,
}: {
  member: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { payHistoryByUser, setPayRate, removePayRate, settings } = useWorkspace();
  const history = payHistoryByUser.get(member.id) ?? [];
  const [from, setFrom] = useState("");
  const [kind, setKind] = useState<PayKind>("hourly");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const today = toDateKey(new Date());
    setFrom(today);
    const current = payChangeOn(payHistoryByUser.get(member.id) ?? [], today);
    setKind(kindOf(current) === "none" ? "hourly" : kindOf(current));
    setAmount("");
    setConfirmingId(null);
    // Only when the dialog opens: a save shouldn't reset what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member.id]);

  const replaces = history.find((r) => r.effectiveFrom === from);
  const parsed = amount.trim() === "" ? null : Number(amount);
  const amountInvalid = kind !== "none" && (parsed === null || Number.isNaN(parsed) || parsed < 0);

  const save = async () => {
    if (!from || amountInvalid) return;
    setSaving(true);
    try {
      await setPayRate({
        userId: member.id,
        effectiveFrom: from,
        hourlyRate: kind === "hourly" ? parsed : null,
        weeklySalary: kind === "salary" ? parsed : null,
      });
      toast.success(replaces ? "Pay change replaced" : "Pay change added");
      setAmount("");
    } catch (error) {
      toast.error("Couldn't save that", { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await removePayRate(id);
      toast.success("Pay change removed");
    } catch (error) {
      toast.error("Couldn't remove that", { description: (error as Error).message });
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay for {member.name}</DialogTitle>
          <DialogDescription>
            Each change applies from its date. Work before that date keeps the pay it had, so a
            raise doesn&apos;t change past weeks.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border">
          {history.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No pay set yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {[...history].reverse().map((r) => (
                <li
                  key={r.id ?? r.effectiveFrom}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <span className="text-muted-foreground">{formatDay(r.effectiveFrom)}</span>
                  <span className="flex-1 font-medium tabular-nums">
                    {payText(r, settings.currency)}
                  </span>
                  {r.id &&
                    (confirmingId === r.id ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7"
                        onClick={() => void remove(r.id!)}
                      >
                        Confirm remove
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => setConfirmingId(r.id!)}
                      >
                        Remove
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-3">
          <p className="text-sm font-medium">Add a change</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-from">Effective from</Label>
              <Input
                id="pay-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-kind">Pay</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PayKind)}>
                <SelectTrigger id="pay-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly rate</SelectItem>
                  <SelectItem value="salary">Weekly salary</SelectItem>
                  <SelectItem value="none">No pay (left)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind !== "none" && (
              <div className="grid gap-1.5">
                <Label htmlFor="pay-amount">
                  {kind === "hourly" ? "Per hour" : "Per week"} ({settings.currency})
                </Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
          {replaces && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This replaces the change on {formatDay(replaces.effectiveFrom)} (
              {payText(replaces, settings.currency)}).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button disabled={saving || !from || amountInvalid} onClick={() => void save()}>
              Save change
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
