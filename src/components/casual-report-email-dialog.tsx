import { useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/combobox";
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
import { addDays, fromDateKey, startOfWeek, toDateKey } from "@/lib/time-utils";
import { useWorkspace, type CasualReportPreview } from "@/lib/workspace-store";

/** How many past weeks the picker offers. Eight covers "I forgot for a month or two" without becoming a scroll. */
const WEEKS_OFFERED = 8;

/** Same cap and shape check as the edge function, so a typo is flagged before Preview. */
const MAX_CC = 5;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Splits the CC box on commas, semicolons or whitespace. */
const parseCc = (raw: string) =>
  raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

/** "22–28 Sep 2026", collapsing month and year when the week doesn't straddle them. */
function weekLabel(weekStartKey: string) {
  const start = fromDateKey(weekStartKey);
  const end = addDays(start, 6);
  const day = (d: Date) => d.getDate();
  const monthYear = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (start.getMonth() === end.getMonth()) {
    return `${day(start)}–${day(end)} ${monthYear(end)}`;
  }
  return `${day(start)} ${start.toLocaleDateString(undefined, { month: "short" })} – ${day(end)} ${monthYear(end)}`;
}

/**
 * M52: sends a client their own Casual Service Productivity Report for a week.
 *
 * Preview-then-send, not send: the Send button stays disabled until a preview
 * has loaded, and the thing previewed is the thing sent — both come from the
 * same edge function, differing by one flag. This is the only email in the app
 * that goes to someone outside the company, so "a person read it before it
 * left" is a property worth enforcing in the UI rather than trusting.
 *
 * Deliberately no schedule behind it. The request was for a weekly report;
 * nothing in this project can send on a timer (no pg_cron/pg_net), and a
 * silent weekly send to clients isn't something to switch on unasked anyway.
 * "Weekly" is the operator's cadence.
 */
export function CasualReportEmailDialog({
  open,
  onOpenChange,
  initialClientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects the client the Casual Service tab is already filtered to, when it's filtered to one. */
  initialClientId?: string | null;
}) {
  const { clients, previewCasualReport, sendCasualReport } = useWorkspace();

  // Weeks run Monday–Sunday everywhere in this app, and the RPC refuses
  // anything else. Last week is the default: the usual reason to open this is
  // to report a week that has finished.
  const weeks = useMemo(() => {
    const lastWeek = startOfWeek(addDays(new Date(), -7));
    return Array.from({ length: WEEKS_OFFERED }, (_, i) => toDateKey(addDays(lastWeek, -7 * i)));
  }, []);

  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [weekStart, setWeekStart] = useState(weeks[0]);
  const [ccRaw, setCcRaw] = useState("");
  const [preview, setPreview] = useState<CasualReportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const clientOptions = useMemo(
    () =>
      clients
        .filter((c) => c.active || c.id === clientId)
        .map((c) => ({
          value: c.id,
          // The address isn't in the label: the preview shows it, and it's the
          // report having no recipient that stops a send, not the list.
          label: c.contactEmail ? c.name : `${c.name} — no contact email`,
        })),
    [clients, clientId],
  );

  const ccList = useMemo(() => parseCc(ccRaw), [ccRaw]);
  const ccKey = ccList.join(",").toLowerCase();
  const ccInvalid = ccList.filter((e) => !EMAIL_RE.test(e));
  const ccError =
    ccInvalid.length > 0
      ? `Not a valid email address: ${ccInvalid.join(", ")}`
      : ccList.length > MAX_CC
        ? `You can copy at most ${MAX_CC} people.`
        : null;
  // The deployed edge function predates CC support: it would send to the
  // client and silently skip everyone copied, so Send stays off until it's
  // redeployed or the CC box is cleared.
  const ccUnsupported = !!preview && preview.cc === undefined && ccList.length > 0;

  // Any change to what would be sent invalidates the approved preview, so
  // Send can never deliver something nobody looked at — including who's
  // copied on it.
  useEffect(() => {
    setPreview(null);
  }, [clientId, weekStart, ccKey]);

  useEffect(() => {
    if (open) {
      setClientId(initialClientId ?? "");
      setCcRaw("");
    }
  }, [open, initialClientId]);

  const loadPreview = async () => {
    if (!clientId || ccError) return;
    setLoading(true);
    try {
      setPreview(await previewCasualReport(clientId, weekStart, ccList));
    } catch (error) {
      setPreview(null);
      toast.error("Couldn't build that report", { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    if (!clientId || !preview || ccUnsupported) return;
    setSending(true);
    try {
      // The CC list the preview approved, as the function normalised it.
      const cc = preview.cc ?? [];
      const { to } = await sendCasualReport(clientId, weekStart, cc);
      toast.success(`Report sent to ${to || preview.to}`, {
        description: cc.length > 0 ? `Copied to ${cc.join(", ")}` : undefined,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't send the report", { description: (error as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Email a client their casual service report</DialogTitle>
          <DialogDescription>
            Their own casual service work for one week — dates, who did it, what it was, and the
            hours billed. No cost, pay rate or margin figures are included. Preview it, then send.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="casual-report-client">Client</Label>
            <Combobox
              id="casual-report-client"
              options={clientOptions}
              value={clientId}
              onChange={setClientId}
              placeholder="Pick a client…"
              searchPlaceholder="Search clients…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="casual-report-week">Week</Label>
            <Select value={weekStart} onValueChange={setWeekStart}>
              <SelectTrigger id="casual-report-week">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((w) => (
                  <SelectItem key={w} value={w}>
                    {weekLabel(w)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="casual-report-cc">
              Cc <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="casual-report-cc"
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="name@example.com, another@example.com"
              value={ccRaw}
              aria-invalid={!!ccError}
              aria-describedby="casual-report-cc-help"
              onChange={(e) => setCcRaw(e.target.value)}
            />
            <p
              id="casual-report-cc-help"
              className={"text-xs " + (ccError ? "text-destructive" : "text-muted-foreground")}
            >
              {ccError ??
                `Copies go to these people as well as the client. Separate with commas, up to ${MAX_CC}.`}
            </p>
          </div>
        </div>

        {preview && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              <p>
                <span className="text-muted-foreground">To</span> {preview.to}
                {preview.contactName ? ` (${preview.contactName})` : ""}
              </p>
              {preview.cc && preview.cc.length > 0 && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Cc</span> {preview.cc.join(", ")}
                </p>
              )}
              <p className="mt-1">
                <span className="text-muted-foreground">Subject</span> {preview.subject}
              </p>
              <p className="mt-1 text-muted-foreground">
                {preview.lineCount} {preview.lineCount === 1 ? "task" : "tasks"},{" "}
                {preview.billedHours.toFixed(2)}h billed
              </p>
            </div>

            {ccUnsupported && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                CC isn&apos;t available yet: the email function needs redeploying first. Clear the
                Cc box to send to the client only.
              </p>
            )}

            {preview.previousSends.length > 0 && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                Already sent for this week —{" "}
                {preview.previousSends
                  .map(
                    (s) =>
                      `${new Date(s.sentAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })} to ${s.recipient} by ${s.sentBy}`,
                  )
                  .join("; ")}
                . Sending again delivers a second email.
              </p>
            )}

            {/* Sandboxed iframe rather than dangerouslySetInnerHTML: this is
                email markup built from staff-typed descriptions, and it has no
                business running or styling anything in the app's own DOM. It
                also shows the layout the client will actually see. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-80 w-full rounded-md border border-border bg-white"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void loadPreview()}
            disabled={!clientId || !!ccError || loading || sending}
          >
            {loading ? "Building…" : preview ? "Rebuild preview" : "Preview"}
          </Button>
          <Button onClick={() => void send()} disabled={!preview || ccUnsupported || sending}>
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            {sending ? "Sending…" : "Send to client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
