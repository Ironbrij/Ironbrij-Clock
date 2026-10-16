import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Trash2, Users } from "lucide-react";
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
import {
  clientMonthlyRevenue,
  managementFee,
  placementWeekFigures,
  vaMonthlyCost,
  type PlacementWeekFigures,
} from "@/lib/retainer";
import { addDays, formatWeekRange, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type WorkspacePlacement } from "@/lib/workspace-store";
import {
  PLACEMENT_CATEGORY_LABELS,
  PLACEMENT_CATEGORY_ORDER,
  type PlacementCategory,
} from "@/lib/workspace/types";
import { ClientLink } from "@/components/detail-panel";
import { placementWeekKey } from "@/lib/workspace/use-placements";

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

/** Hours as an input's text, to the cent-of-an-hour precision the column stores. */
const asHours = (n: number | null) => (n === null ? "" : String(Math.round(n * 100) / 100));

/**
 * M49: the admin editor for VA retainer placements — the "VA Package"
 * sheet. Lives in Manage for the same reason the Billing Rates and Casual
 * Service tabs do: Reports is read/export-only, Manage is where privileged
 * row-level actions live.
 *
 * Ending a placement sets its end date rather than deleting the row, so
 * past weeks stay priced in every report.
 *
 * Since 2026-10-16 placements are hourly on both sides, on each week's
 * actual hours, which accounts enters in the "Week covered" view
 * (src/lib/retainer.ts).
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
    placementWeekHoursForRange,
    setPlacementWeekHours,
  } = useWorkspace();

  const [statusFilter, setStatusFilter] = useState<"active" | "ended" | "all">("active");
  // "Week covered" (2026-10-14): null shows the monthly view, where rates are
  // edited; a Monday date key shows that week's figures, where accounts
  // enters each placement's actual hours (2026-10-16).
  const [weekStart, setWeekStart] = useState<string | null>(null);
  // That week's entered hours, keyed by placementWeekKey. Bumping the
  // version reloads them after a save.
  const [weekHours, setWeekHours] = useState<Map<string, number>>(new Map());
  const [weekHoursVersion, setWeekHoursVersion] = useState(0);
  const [adding, setAdding] = useState(false);

  const thisWeek = toDateKey(startOfWeek(new Date()));
  const shiftWeek = (from: string, weeks: number) =>
    toDateKey(addDays(fromDateKey(from), weeks * 7));

  const vaName = useMemo(() => {
    const map = new Map(placedVAs.map((v) => [v.id, v.fullName]));
    return (id: string) => map.get(id) ?? "Unknown VA";
  }, [placedVAs]);

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Unknown client";
  }, [clients]);

  useEffect(() => {
    if (weekStart === null || !canManage) {
      setWeekHours(new Map());
      return;
    }
    let cancelled = false;
    placementWeekHoursForRange(weekStart, toDateKey(addDays(fromDateKey(weekStart), 6)))
      .then((hours) => {
        if (!cancelled) setWeekHours(hours);
      })
      .catch((error: Error) =>
        toast.error("Couldn't load that week's hours", { description: error.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [weekStart, canManage, placementWeekHoursForRange, weekHoursVersion]);

  const saveWeekHours = async (placementId: string, hours: number | null) => {
    if (weekStart === null) return;
    await setPlacementWeekHours(placementId, weekStart, hours);
    setWeekHoursVersion((v) => v + 1);
  };

  const rows = useMemo<PlacementRowData[]>(
    () =>
      placements
        .map((p) => ({
          ...p,
          vaLabel: vaName(p.placedVaId),
          clientLabel: clientName(p.clientId),
          fee: managementFee(p),
          week:
            weekStart === null
              ? null
              : placementWeekFigures(
                  p,
                  weekStart,
                  weekHours.get(placementWeekKey(p.id, weekStart)) ?? null,
                ),
        }))
        // With a week picked, "live that week" is the filter — including
        // placements that have since ended. Otherwise filter by status.
        .filter((r) =>
          r.week !== null
            ? r.week.days > 0
            : statusFilter === "all"
              ? true
              : statusFilter === "active"
                ? r.endedOn === null
                : r.endedOn !== null,
        )
        .sort(
          (a, b) =>
            a.vaLabel.localeCompare(b.vaLabel) || a.clientLabel.localeCompare(b.clientLabel),
        ),
    [placements, statusFilter, weekStart, weekHours, vaName, clientName],
  );

  // One section per category, in the weekly sheet's order.
  const sections = PLACEMENT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  }));
  const combined = sumRows(rows);

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

  const period = weekStart === null ? "/mo" : "/wk";

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {weekStart === null && (
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
        )}
        {weekStart === null ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setWeekStart(thisWeek)}
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" /> Week covered
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Week covered">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="min-w-36 px-1 text-center text-sm font-medium">
              {formatWeekRange(fromDateKey(weekStart))}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            {weekStart !== thisWeek && (
              <Button variant="ghost" size="sm" onClick={() => setWeekStart(thisWeek)}>
                This week
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setWeekStart(null)}>
              All weeks
            </Button>
          </div>
        )}
        <Button size="sm" onClick={() => setAdding(true)}>
          Add placement
        </Button>
        <p className="text-xs text-muted-foreground">
          {weekStart === null
            ? "Rates are per hour (per unit for LMT). The /mo figures are at contracted hours × 52 ÷ 12, and the management fee is invoiced minus VA cost — calculated, not entered. Each week's actual hours go in Week covered. Ending a placement keeps its history so past reports stay correct."
            : "Enter each VA's actual hours for this week (units for LMT). An empty cell uses the contracted hours, shown faintly, and a placement that started or ended mid-week gets only its days' share of them. VA cost and invoiced are those hours × each rate. Pick All weeks to change rates."}
        </p>
      </div>

      {sections.map((section) => (
        <PlacementSection
          key={section.category}
          title={PLACEMENT_CATEGORY_LABELS[section.category]}
          rows={section.rows}
          weekMode={weekStart !== null}
          currency={settings.currency}
          onUpdate={updatePlacement}
          onDelete={deletePlacement}
          onSaveHours={saveWeekHours}
        />
      ))}

      {rows.length > 0 && (
        <Card className="shadow-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-5 py-4 text-sm">
            <span className="font-semibold">Combined total</span>
            <span className="flex flex-wrap gap-x-8 gap-y-1 tabular-nums">
              <span>
                <span className="text-muted-foreground">VA cost {period} </span>
                {money(combined.cost, settings.currency)}
              </span>
              <span>
                <span className="text-muted-foreground">Invoiced {period} </span>
                {money(combined.revenue, settings.currency)}
              </span>
              <span className="font-semibold">
                <span className="font-normal text-muted-foreground">Management fee {period} </span>
                {money(combined.fee, settings.currency)}
              </span>
            </span>
          </CardContent>
        </Card>
      )}

      <AddPlacementDialog open={adding} onOpenChange={setAdding} onSubmit={createPlacement} />
    </div>
  );
}

type PlacementRowData = WorkspacePlacement & {
  vaLabel: string;
  clientLabel: string;
  /** Monthly management fee. */
  fee: number;
  /** That week's figures when a week is picked; null in the monthly view. */
  week: PlacementWeekFigures | null;
};

type UpdatePlacement = (
  id: string,
  patch: {
    endedOn?: string | null;
    vaHourlyRate?: number | null;
    contractedWeeklyHours?: number | null;
    clientHourlyRate?: number | null;
    category?: PlacementCategory;
  },
) => Promise<void>;

type SaveWeekHours = (placementId: string, hours: number | null) => Promise<void>;

/** Sums the shown figures — that week's, or monthly. Unpriced amounts are left out, not counted as 0. */
function sumRows(rows: PlacementRowData[]) {
  return rows.reduce(
    (acc, r) => {
      const cost = r.week ? r.week.cost : vaMonthlyCost(r);
      const revenue = r.week ? r.week.revenue : clientMonthlyRevenue(r);
      return {
        cost: acc.cost + (cost ?? 0),
        revenue: acc.revenue + (revenue ?? 0),
        fee: acc.fee + (r.week ? r.week.fee : r.fee),
      };
    },
    { cost: 0, revenue: 0, fee: 0 },
  );
}

function PlacementSection({
  title,
  rows,
  weekMode,
  currency,
  onUpdate,
  onDelete,
  onSaveHours,
}: {
  title: string;
  rows: PlacementRowData[];
  weekMode: boolean;
  currency: string;
  onUpdate: UpdatePlacement;
  onDelete: (id: string) => Promise<void>;
  onSaveHours: SaveWeekHours;
}) {
  const totals = sumRows(rows);
  const period = weekMode ? "/wk" : "/mo";
  const columns = weekMode ? 10 : 12;
  // Columns before VA cost, which the subtotal label spans.
  const labelSpan = weekMode ? 6 : 7;

  return (
    <section aria-label={`${title} placements`} className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        <span className="text-xs font-normal text-muted-foreground">
          {rows.length} {rows.length === 1 ? "placement" : "placements"}
        </span>
      </h2>
      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          {/* Tighter cell padding than other tables (px-3, keeping px-5 at the outer
              edges) so every column fits without a sideways scroll. */}
          <table className="w-full min-w-[1060px] text-sm [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-3 text-left font-medium">VA</th>
                <th className="px-3 py-3 text-left font-medium">Client</th>
                <th className="px-3 py-3 text-left font-medium">Started</th>
                <th className="px-3 py-3 text-left font-medium">Category</th>
                {weekMode ? (
                  <>
                    <th className="px-3 py-3 text-right font-medium">Days</th>
                    <th className="px-3 py-3 text-right font-medium">Hours</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-3 text-right font-medium">VA rate /hr</th>
                    <th className="px-3 py-3 text-right font-medium">Hours /wk</th>
                    <th className="px-3 py-3 text-right font-medium">Invoice rate /hr</th>
                  </>
                )}
                <th className="px-3 py-3 text-right font-medium">VA cost {period}</th>
                <th className="px-3 py-3 text-right font-medium">Invoiced {period}</th>
                <th className="px-3 py-3 text-right font-medium">Management fee {period}</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                {!weekMode && <th className="w-12 px-3 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns}
                    className="px-5 py-8 text-center text-sm text-muted-foreground"
                  >
                    No {title} placements {weekMode ? "that week" : "in this filter"}.
                  </td>
                </tr>
              ) : weekMode ? (
                rows.map((r) => (
                  <PlacementWeekRow
                    key={r.id}
                    row={r}
                    currency={currency}
                    onSaveHours={onSaveHours}
                  />
                ))
              ) : (
                rows.map((r) => (
                  <PlacementRow
                    key={r.id}
                    placement={r}
                    vaLabel={r.vaLabel}
                    clientLabel={r.clientLabel}
                    fee={r.fee}
                    currency={currency}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                  />
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-3 py-3 font-semibold" colSpan={labelSpan}>
                    {title} subtotal
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {money(totals.cost, currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {money(totals.revenue, currency)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">
                    {money(totals.fee, currency)}
                  </td>
                  <td className="px-3 py-3" colSpan={weekMode ? 1 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

/** The five categories as select options, in the weekly sheet's order. */
function PlacementCategoryOptions() {
  return (
    <>
      {PLACEMENT_CATEGORY_ORDER.map((category) => (
        <SelectItem key={category} value={category}>
          {PLACEMENT_CATEGORY_LABELS[category]}
        </SelectItem>
      ))}
    </>
  );
}

function StatusBadge({ endedOn }: { endedOn: string | null }) {
  return endedOn === null ? (
    <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Ended {formatDate(endedOn)}
    </Badge>
  );
}

/**
 * A placement's figures for the picked week, with its actual hours editable.
 * An empty Hours cell means "use the contracted hours", which show as the
 * placeholder; clearing a cell deletes that week's entry again.
 */
function PlacementWeekRow({
  row,
  currency,
  onSaveHours,
}: {
  row: PlacementRowData;
  currency: string;
  onSaveHours: SaveWeekHours;
}) {
  const week = row.week!;
  const entered = week.hoursEntered ? asHours(week.hours) : "";
  const [hours, setHours] = useState(entered);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHours(entered);
  }, [entered]);

  const save = async () => {
    const trimmed = hours.trim();
    if (trimmed === entered) return;
    const parsed = trimmed === "" ? null : Number(trimmed);
    // Same bounds as placement_week_hours' CHECK constraint.
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 168)) {
      toast.error("Hours must be between 0 and 168");
      setHours(entered);
      return;
    }
    setBusy(true);
    try {
      await onSaveHours(row.id, parsed);
    } catch (error) {
      toast.error("Couldn't save hours", { description: (error as Error).message });
      setHours(entered);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-3 py-3 font-medium">{row.vaLabel}</td>
      <td className="px-3 py-3">
        <ClientLink id={row.clientId}>{row.clientLabel}</ClientLink>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
        {formatDate(row.startedOn)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">{PLACEMENT_CATEGORY_LABELS[row.category]}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">
        {week.days === 7 ? "Full week" : `${week.days} of 7 days`}
      </td>
      <td className="px-3 py-3 text-right">
        <Input
          type="number"
          min="0"
          max="168"
          step="0.25"
          placeholder={week.hoursEntered || week.hours === null ? "—" : asHours(week.hours)}
          title={
            week.hoursEntered
              ? "Hours entered for this week"
              : "Contracted hours. Type this week's actual hours to replace them."
          }
          aria-label={`Hours this week for ${row.vaLabel} at ${row.clientLabel}`}
          value={hours}
          disabled={busy}
          onChange={(e) => setHours(e.target.value)}
          onBlur={() => void save()}
          className="ml-auto h-8 w-20 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{money(week.cost, currency)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{money(week.revenue, currency)}</td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">
        {money(week.fee, currency)}
      </td>
      <td className="px-3 py-3">
        <StatusBadge endedOn={row.endedOn} />
      </td>
    </tr>
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
  onUpdate: UpdatePlacement;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(asInput(placement.vaHourlyRate));
  const [hours, setHours] = useState(asInput(placement.contractedWeeklyHours));
  const [invoice, setInvoice] = useState(asInput(placement.clientHourlyRate));
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    setRate(asInput(placement.vaHourlyRate));
    setHours(asInput(placement.contractedWeeklyHours));
    setInvoice(asInput(placement.clientHourlyRate));
  }, [placement.vaHourlyRate, placement.contractedWeeklyHours, placement.clientHourlyRate]);

  // Same shape as the hourly-rate field in Manage → Schedule: no-op when
  // unchanged, reject anything unparseable, revert local state on failure.
  const saveAmount = async (
    field: "vaHourlyRate" | "contractedWeeklyHours" | "clientHourlyRate",
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

  const changeCategory = async (category: PlacementCategory) => {
    if (category === placement.category) return;
    setBusy(true);
    try {
      await onUpdate(placement.id, { category });
      toast.success(`Moved to ${PLACEMENT_CATEGORY_LABELS[category]}`, {
        description: `${vaLabel} at ${clientLabel}`,
      });
    } catch (error) {
      toast.error("Couldn't change the type", { description: (error as Error).message });
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
      <td className="px-3 py-3 font-medium">{vaLabel}</td>
      <td className="px-3 py-3">
        <ClientLink id={placement.clientId}>{clientLabel}</ClientLink>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
        {formatDate(placement.startedOn)}
      </td>
      <td className="px-3 py-3">
        <Select
          value={placement.category}
          disabled={busy}
          onValueChange={(v) => void changeCategory(v as PlacementCategory)}
        >
          <SelectTrigger
            className="h-8 w-44"
            aria-label={`Category for ${vaLabel} at ${clientLabel}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <PlacementCategoryOptions />
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-3 text-right">
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
          className="ml-auto h-8 w-20 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right">
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
          className="ml-auto h-8 w-16 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right">
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="N/A"
          aria-label={`Client invoice rate per hour for ${vaLabel} at ${clientLabel}`}
          value={invoice}
          disabled={busy}
          onChange={(e) => setInvoice(e.target.value)}
          onBlur={() =>
            void saveAmount(
              "clientHourlyRate",
              invoice,
              asInput(placement.clientHourlyRate),
              setInvoice,
            )
          }
          className="ml-auto h-8 w-20 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
        {money(vaMonthlyCost(placement), currency)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
        {money(clientMonthlyRevenue(placement), currency)}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(fee, currency)}</td>
      <td className="px-3 py-3">
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
          <StatusBadge endedOn={placement.endedOn} />
        </button>
      </td>
      <td className="px-3 py-3">
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
                This deletes the placement and its history, so past reports will no longer include
                it. If the placement has just finished, end it instead — click its Active badge —
                which keeps past reports correct. This can't be undone.
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
    clientHourlyRate: number | null;
    category: PlacementCategory;
  }) => Promise<void>;
}) {
  const { clients, placedVAs, settings } = useWorkspace();

  const [vaChoice, setVaChoice] = useState("");
  const [newVaName, setNewVaName] = useState("");
  const [clientId, setClientId] = useState("");
  const [startedOn, setStartedOn] = useState(toDateKey(new Date()));
  const [rate, setRate] = useState("");
  const [hours, setHours] = useState("40");
  const [invoice, setInvoice] = useState("");
  const [category, setCategory] = useState<PlacementCategory>("full_time");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVaChoice("");
    setNewVaName("");
    setClientId("");
    setStartedOn(toDateKey(new Date()));
    setRate("");
    setHours("40");
    setInvoice("");
    setCategory("full_time");
  }, [open]);

  const parse = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
  const rateInvalid = rate.trim() !== "" && Number.isNaN(Number(rate.trim()));
  const invoiceInvalid = invoice.trim() !== "" && Number.isNaN(Number(invoice.trim()));
  const hoursValue = parse(hours);
  const hoursInvalid =
    hoursValue !== null && (Number.isNaN(hoursValue) || hoursValue <= 0 || hoursValue > 168);
  const previewCost =
    rateInvalid || hoursInvalid
      ? null
      : vaMonthlyCost({ vaHourlyRate: parse(rate), contractedWeeklyHours: hoursValue });
  const previewRevenue =
    invoiceInvalid || hoursInvalid
      ? null
      : clientMonthlyRevenue({
          clientHourlyRate: parse(invoice),
          contractedWeeklyHours: hoursValue,
        });
  const vaReady = vaChoice === NEW_VA ? newVaName.trim() !== "" : vaChoice !== "";
  const canSubmit =
    !saving &&
    vaReady &&
    !!clientId &&
    !!startedOn &&
    !rateInvalid &&
    !hoursInvalid &&
    !invoiceInvalid;

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
        clientHourlyRate: parse(invoice),
        category,
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
            A VA placed with a client, billed by the hour on both sides: what the VA is paid and
            what the client is invoiced. Each week&apos;s actual hours are entered under Week
            covered; until then the contracted hours are used. Leave a rate blank if that side
            isn&apos;t priced — the management fee then reads zero rather than a negative.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="placement-va">VA</Label>
            <Combobox
              id="placement-va"
              // First, so adding someone new is the obvious move rather than a
              // row at the bottom of a long list.
              options={[
                { value: NEW_VA, label: "+ Add a new VA…" },
                ...placedVAs.map((v) => ({ value: v.id, label: v.fullName })),
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
              <Label htmlFor="placement-type">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as PlacementCategory)}>
                <SelectTrigger id="placement-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <PlacementCategoryOptions />
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="placement-invoice">Invoice rate /hr ({settings.currency})</Label>
              <Input
                id="placement-invoice"
                type="number"
                min="0"
                step="0.01"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
            </div>
          </div>
          {previewCost !== null && (
            <p className="text-xs text-muted-foreground">
              VA cost ≈ {money(previewCost, settings.currency)} /mo
              {previewRevenue !== null &&
                ` · invoiced ≈ ${money(previewRevenue, settings.currency)} /mo · management fee ≈ ${money(previewRevenue - previewCost, settings.currency)} /mo`}
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
