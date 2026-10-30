import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  buildPreviewRows,
  matchClientNames,
  parseRemainingHoursPaste,
  type ParsedLine,
  type PreviewRow,
  type UnreadLine,
} from "@/lib/remaining-hours-import";
import { useClientRenderedHours, useWorkspace } from "@/lib/workspace-store";

/** Hours as the sheet shows them: decimals, not "23h 45m", so the two are easy to compare. */
const hours = (n: number) => n.toFixed(2);
const signed = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

/**
 * Projects → Clients → Import remaining hours (2026-10-30). Accounts pastes
 * client names and Remaining Hours from the Casual Service | Monitoring
 * sheet; IronTrack shows what would change and, for the rows ticked, sets
 * each client's subscription hours so its remaining hours equal the sheet's.
 * Nothing else is written, and nothing is ticked until someone ticks it.
 */
export function ImportRemainingHoursDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { clients, setClientSubscriptionHours, clientPlacementHoursLoaded } = useWorkspace();
  const rendered = useClientRenderedHours();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ rows: ParsedLine[]; unread: UnreadLine[] } | null>(null);
  const [chosen, setChosen] = useState<Map<number, string | null>>(new Map());
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setText("");
      setParsed(null);
      setChosen(new Map());
      setTicked(new Set());
      setFailures([]);
    }
  }, [open]);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const clientOptions = useMemo(
    () =>
      [...clients]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inactive)` })),
    [clients],
  );
  const figures = useMemo(
    () =>
      new Map(
        clients.map((c) => {
          const r = rendered.get(c.id);
          return [
            c.id,
            {
              subscriptionHours: c.subscriptionHours,
              renderedHours: (r?.trackedHours ?? 0) + (r?.placementHours ?? 0),
            },
          ];
        }),
      ),
    [clients, rendered],
  );

  const rows = useMemo(
    () => (parsed ? buildPreviewRows(parsed.rows, chosen, figures) : []),
    [parsed, chosen, figures],
  );
  const applicable = rows.filter((r) => r.status === "ok");
  const toApply = applicable.filter((r) => ticked.has(r.line));
  const allTicked = applicable.length > 0 && toApply.length === applicable.length;
  const needClient = rows.filter((r) => r.status === "unmatched").length;

  const preview = () => {
    const result = parseRemainingHoursPaste(text);
    setParsed(result);
    setChosen(matchClientNames(result.rows, clients));
    setTicked(new Set());
    setFailures([]);
  };

  const choose = (line: number, clientId: string) => {
    setChosen((prev) => new Map(prev).set(line, clientId || null));
    setTicked((prev) => {
      const next = new Set(prev);
      next.delete(line);
      return next;
    });
  };

  const toggle = (line: number, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(line);
      else next.delete(line);
      return next;
    });

  const apply = async () => {
    setApplying(true);
    const failed: string[] = [];
    let updated = 0;
    // One at a time, so a failure part-way leaves a clear list of what did and didn't save.
    for (const r of toApply) {
      try {
        await setClientSubscriptionHours(r.clientId!, r.newSubscription!);
        updated++;
      } catch (error) {
        failed.push(`${clientName.get(r.clientId!) ?? r.sheetName}: ${(error as Error).message}`);
      }
    }
    setApplying(false);
    setTicked(new Set());
    if (updated > 0) {
      toast.success(`Updated ${updated} ${updated === 1 ? "client" : "clients"}`);
    }
    setFailures(failed);
    if (failed.length > 0) {
      toast.error(`${failed.length} couldn't be updated`, {
        description: "They're listed in the dialog.",
      });
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !applying && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import remaining hours</DialogTitle>
          <DialogDescription>
            Sets each client&apos;s subscription hours so IronTrack&apos;s remaining hours match the
            sheet. Only subscription hours change; time entries and billing aren&apos;t touched.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="grid gap-2 py-2">
            <Label htmlFor="remaining-hours-paste">
              Copy the client name and Remaining Hours columns from Casual Service | Monitoring and
              paste them here.
            </Label>
            <Textarea
              id="remaining-hours-paste"
              autoFocus
              rows={12}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Arnab Nandi\t23.75\nEquity Investments Group\t10.10"}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Copy from the sheet itself rather than the PDF summary, which leaves out hidden rows.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? "line" : "lines"} read
              {needClient > 0 && ` · ${needClient} need a client picked`}
              {` · ${applicable.length} can be applied`}. Nothing is saved until you tick clients
              and click Apply.
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Tick every client that can be applied"
                        checked={allTicked}
                        disabled={applicable.length === 0}
                        onCheckedChange={(v) =>
                          setTicked(v ? new Set(applicable.map((r) => r.line)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>In the sheet</TableHead>
                    <TableHead>IronTrack client</TableHead>
                    <TableHead className="text-right">IronTrack now</TableHead>
                    <TableHead className="text-right">Sheet</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead className="text-right">New subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <PreviewTableRow
                      key={r.line}
                      row={r}
                      ticked={ticked.has(r.line)}
                      onTick={(on) => toggle(r.line, on)}
                      clientOptions={clientOptions}
                      onChoose={(id) => choose(r.line, id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            {!clientPlacementHoursLoaded && (
              <p className="text-sm text-destructive">
                Placed VAs' hours haven't loaded, so the new subscriptions would be wrong for
                clients with placements. Apply stays off until they load: wait a moment, or reload
                the page.
              </p>
            )}
            {parsed.unread.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">
                  {parsed.unread.length === 1 ? "This line has" : "These lines have"} no hours at
                  the end and won&apos;t be imported:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {parsed.unread.map((u) => (
                    <li key={u.line}>
                      Line {u.line}: {u.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {failures.length > 0 && (
              <div className="text-xs text-destructive">
                <p className="font-medium">These weren&apos;t updated:</p>
                <ul className="mt-1 list-disc pl-5">
                  {failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!parsed ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={text.trim() === ""} onClick={preview}>
                Preview
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={applying} onClick={() => setParsed(null)}>
                Back
              </Button>
              <Button
                disabled={applying || toApply.length === 0 || !clientPlacementHoursLoaded}
                onClick={() => void apply()}
              >
                Apply to {toApply.length} {toApply.length === 1 ? "client" : "clients"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewTableRow({
  row,
  ticked,
  onTick,
  clientOptions,
  onChoose,
}: {
  row: PreviewRow;
  ticked: boolean;
  onTick: (on: boolean) => void;
  clientOptions: { value: string; label: string }[];
  onChoose: (clientId: string) => void;
}) {
  return (
    <TableRow className={row.status === "ok" ? undefined : "text-muted-foreground"}>
      <TableCell>
        <Checkbox
          aria-label={`Apply ${row.sheetName}`}
          checked={ticked}
          disabled={row.status !== "ok"}
          onCheckedChange={(v) => onTick(v === true)}
        />
      </TableCell>
      <TableCell className="font-medium text-foreground">{row.sheetName}</TableCell>
      <TableCell className="min-w-[220px]">
        <Combobox
          options={clientOptions}
          value={row.clientId ?? ""}
          onChange={onChoose}
          placeholder="Pick a client…"
          searchPlaceholder="Search clients…"
          triggerClassName="h-8"
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.clientId === null
          ? "—"
          : row.currentRemaining === null
            ? "No allowance"
            : hours(row.currentRemaining)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{hours(row.sheetHours)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.status === "duplicate" ? (
          <span className="text-destructive">Same client twice</span>
        ) : row.status === "no-change" ? (
          "No change"
        ) : row.difference === null ? (
          "—"
        ) : (
          signed(row.difference)
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.newSubscription === null ? "—" : hours(row.newSubscription)}
      </TableCell>
    </TableRow>
  );
}
