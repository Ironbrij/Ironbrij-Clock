import { useEffect, useMemo, useState } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMinutes } from "@/lib/mock-data";
import { addDays, fromDateKey, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type DetailedEntry } from "@/lib/workspace-store";
import { CASUAL_SERVICE_CATEGORY_LABELS, type CasualServiceCategory } from "@/lib/workspace/types";

const DEFAULT_RANGE_DAYS = 90;

/**
 * M46: the admin *action* view (mark VA-paid) for Casual Service
 * Monitoring — lives in Manage rather than Reports because Manage is
 * where this app's other privileged, row-level actions already live
 * (Approvals, Entries). Reports' own "Casual Service" tab is the
 * read/export rollup; this is the "do something about a specific row"
 * counterpart, same split as everywhere else in this app.
 */
export function CasualServiceTab() {
  const { canManage, clients, projects, members, detailedEntriesForRange, markCasualEntriesPaid } =
    useWorkspace();

  const todayKey = toDateKey(new Date());
  const [from, setFrom] = useState(toDateKey(addDays(new Date(), -DEFAULT_RANGE_DAYS)));
  const [to, setTo] = useState(todayKey);
  const [categoryFilter, setCategoryFilter] = useState<"all" | CasualServiceCategory>("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [entries, setEntries] = useState<DetailedEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    detailedEntriesForRange(from, to)
      .then((rows) => {
        if (!cancelled) setEntries(rows.filter((e) => e.serviceCategory !== null));
      })
      .catch((error: Error) =>
        toast.error("Couldn't load casual service entries", { description: error.message }),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, canManage, detailedEntriesForRange]);

  useEffect(() => {
    setSelected(new Set());
  }, [from, to, categoryFilter, clientFilter, paidFilter]);

  const rows = useMemo(() => {
    return (entries ?? [])
      .map((e) => {
        const project = projects.find((p) => p.id === e.projectId);
        const member = members.find((m) => m.id === e.userId);
        return {
          ...e,
          clientId: project?.clientId ?? null,
          clientName: project?.clientId
            ? (clients.find((c) => c.id === project.clientId)?.name ?? "Unknown client")
            : "No client",
          vaName: member?.name ?? "Former member",
        };
      })
      .filter((r) => categoryFilter === "all" || r.serviceCategory === categoryFilter)
      .filter((r) => clientFilter === "all" || r.clientId === clientFilter)
      .filter((r) => {
        if (paidFilter === "all") return true;
        return paidFilter === "paid" ? !!r.vaPaidAt : !r.vaPaidAt;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, projects, members, clients, categoryFilter, clientFilter, paidFilter]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyPaidStatus = async (paidDate: string | null) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await markCasualEntriesPaid(Array.from(selected), paidDate);
      toast.success(
        paidDate
          ? `Marked ${selected.size} ${selected.size === 1 ? "entry" : "entries"} as paid`
          : `Cleared paid status on ${selected.size} ${selected.size === 1 ? "entry" : "entries"}`,
      );
      setSelected(new Set());
      // Re-fetch — the entries themselves live in workspace-wide time_entries
      // state that markCasualEntriesPaid already invalidates, but this
      // component holds its own local copy fetched via detailedEntriesForRange.
      setEntries((prev) =>
        prev ? prev.map((e) => (selected.has(e.id) ? { ...e, vaPaidAt: paidDate } : e)) : prev,
      );
    } catch (error) {
      toast.error("Couldn't update paid status", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <Card className="mt-4 shadow-card">
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Banknote className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold">Managers and admins only</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Casual service entries and VA payout status are only visible to people who manage the
            workspace.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <input
          type="date"
          value={to}
          min={from}
          max={todayKey}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Select
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter(v as "all" | CasualServiceCategory)}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(Object.keys(CASUAL_SERVICE_CATEGORY_LABELS) as CasualServiceCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {CASUAL_SERVICE_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Combobox
          options={[
            { value: "all", label: "All clients" },
            ...clients.map((c) => ({ value: c.id, label: c.name })),
          ]}
          value={clientFilter}
          onChange={setClientFilter}
          searchPlaceholder="Search clients…"
          triggerClassName="w-48"
        />
        <Select value={paidFilter} onValueChange={(v) => setPaidFilter(v as typeof paidFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Paid + unpaid</SelectItem>
            <SelectItem value="paid">Paid only</SelectItem>
            <SelectItem value="unpaid">Unpaid only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-2">
          <span className="text-sm">
            {selected.size} {selected.size === 1 ? "entry" : "entries"} selected
          </span>
          <Button size="sm" disabled={busy} onClick={() => void applyPaidStatus(todayKey)}>
            Mark as paid today
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void applyPaidStatus(null)}
          >
            Clear paid status
          </Button>
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-5 py-3">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </th>
                <th className="px-5 py-3 text-left font-medium">Date</th>
                <th className="px-5 py-3 text-left font-medium">Client</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">VA</th>
                <th className="px-5 py-3 text-left font-medium">Task</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
                <th className="px-5 py-3 text-left font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No casual service entries in this filter.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                      {fromDateKey(r.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3 font-medium">{r.clientName}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory!]}
                    </td>
                    <td className="px-5 py-3">{r.vaName}</td>
                    <td className="px-5 py-3 text-muted-foreground">{r.task || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatMinutes(r.minutes)}
                    </td>
                    <td className="px-5 py-3">
                      {r.vaPaidAt ? (
                        <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
                          Paid{" "}
                          {fromDateKey(r.vaPaidAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Unpaid
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
