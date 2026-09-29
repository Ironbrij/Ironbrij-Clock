import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * M52: the client-facing Casual Service Productivity Report email.
 *
 * Both calls go through the same edge function, `notify-casual-report`, which
 * composes the email from a SECURITY DEFINER RPC. Nothing here decides what
 * the client is told: this hook only ever names a client and a week, and gets
 * back the finished article. That is what makes the preview trustworthy —
 * `preview` and send take the identical path, differing in one flag, so the
 * manager approves the exact payload that goes out.
 *
 * See supabase/functions/notify-casual-report/index.ts and
 * supabase/migrations/20260929000000_casual_report_emails.sql.
 */

/** One earlier send of the same client/week — the preview warns rather than blocks. */
export type CasualReportPreviousSend = {
  sentAt: string;
  recipient: string;
  sentBy: string;
  billedHours: number;
};

export type CasualReportPreview = {
  /** The address the report will go to — from the client record, never from this app's state. */
  to: string;
  contactName: string | null;
  subject: string;
  /** The rendered email. Shown in a sandboxed iframe; never injected into the app's own DOM. */
  html: string;
  lineCount: number;
  billedHours: number;
  previousSends: CasualReportPreviousSend[];
};

type PreviewResponse = {
  to: string;
  contact_name: string | null;
  subject: string;
  html: string;
  line_count: number;
  billed_hours: number;
  previous_sends: {
    sent_at: string;
    recipient: string;
    sent_by: string;
    billed_hours: number;
  }[];
};

/**
 * A non-2xx from an edge function arrives as a FunctionsHttpError whose own
 * message is just "Edge Function returned a non-2xx status code" — the real
 * reason ("No contact email on file for …", "No casual service work is logged
 * for …") is in the response body, so it has to be read back out of the
 * context. Same unwrapping remindToSubmit does in use-timesheets.ts.
 */
async function unwrapFunctionError(error: unknown, fallback: string): Promise<never> {
  const detail = await (error as { context?: Response }).context
    ?.json()
    .then((b: { error?: string }) => b?.error)
    .catch(() => undefined);
  throw new Error(detail || (error as { message?: string }).message || fallback);
}

export function useCasualReportsData() {
  const qc = useQueryClient();

  const previewCasualReport = useCallback(
    async (clientId: string, weekStart: string): Promise<CasualReportPreview> => {
      const { data, error } = await supabase.functions.invoke<PreviewResponse>(
        "notify-casual-report",
        { body: { client_id: clientId, week_start: weekStart, preview: true } },
      );
      if (error) {
        await unwrapFunctionError(error, "Couldn't build that report.");
      }
      if (!data) throw new Error("Couldn't build that report.");
      return {
        to: data.to,
        contactName: data.contact_name,
        subject: data.subject,
        html: data.html,
        lineCount: data.line_count,
        billedHours: Number(data.billed_hours),
        previousSends: (data.previous_sends ?? []).map((s) => ({
          sentAt: s.sent_at,
          recipient: s.recipient,
          sentBy: s.sent_by,
          billedHours: Number(s.billed_hours),
        })),
      };
    },
    [],
  );

  const sendCasualReport = useCallback(
    async (clientId: string, weekStart: string): Promise<{ to: string }> => {
      const { data, error } = await supabase.functions.invoke<{ sent: number; to: string }>(
        "notify-casual-report",
        { body: { client_id: clientId, week_start: weekStart } },
      );
      if (error) {
        await unwrapFunctionError(error, "The report couldn't be delivered.");
      }
      // The send is logged to activity_log by record_casual_report_email, so
      // Manage → Activity has to refetch to show it.
      qc.invalidateQueries({ queryKey: ["activity_log"] });
      return { to: data?.to ?? "" };
    },
    [qc],
  );

  return { previewCasualReport, sendCasualReport };
}
