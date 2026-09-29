// M52: emails a client their own Casual Service Productivity Report for one
// week. Triggered from Manage → Casual Service; never on a schedule.
//
// Closely modelled on notify-timesheet-reminder (M47), which is itself
// modelled on notify-timesheet-submitted (M29) — same SendGrid account, same
// secrets, same caller-privilege approach. Read those first; the reasoning
// below only covers what differs.
//
// What differs, and why it matters more here: the recipient is **outside the
// company**. So:
//
//   * `preview: true` composes exactly what would be sent and returns it
//     without touching SendGrid. The UI shows that, and the manager sends
//     from the same payload — the preview can't drift from the article.
//   * Nothing the browser sends decides the content. The body is built from
//     casual_report_for_client()'s return value, and the recipient address
//     comes from the same place. The browser only ever names a client id and
//     a week; it cannot supply an address, an hour figure or a line of HTML.
//   * The audit row is written *after* SendGrid accepts (see the migration
//     for why this ordering is the opposite of M47's).
//
// Requires the same two secrets as the other notify functions
// (SENDGRID_API_KEY, NOTIFY_FROM_ADDRESS) and refuses to send without them.
// Deploy with: supabase functions deploy notify-casual-report

// @ts-expect-error Deno-only global, not available in this repo's Node/tsc typecheck
import { createClient } from "npm:@supabase/supabase-js@2";

// @ts-expect-error Deno global
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-expect-error Deno global
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// @ts-expect-error Deno global
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
// @ts-expect-error Deno global
const FROM_ADDRESS_RAW = Deno.env.get("NOTIFY_FROM_ADDRESS");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ReportLine = {
  date: string;
  va: string;
  task: string;
  description: string;
  hours: number;
};

/** One earlier send of this same client/week, so a preview can warn about a repeat. */
type PreviousSend = {
  sent_at: string;
  recipient: string;
  sent_by: string;
  billed_hours: number;
};

type Report = {
  client_name: string;
  contact_name: string | null;
  recipient_email: string;
  week_start: string;
  billed_hours: number;
  line_count: number;
  lines: ReportLine[];
  previous_sends: PreviousSend[];
};

/** Parses "Name <email@domain>" (or a bare "email@domain") into SendGrid's separate name/email fields. */
function parseFromAddress(raw: string): { name?: string; email: string } | null {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^<>]+)>\s*$/.exec(raw);
  if (match) {
    const name = match[1]?.trim();
    return { name: name || undefined, email: match[2].trim() };
  }
  const email = raw.trim();
  return email ? { email } : null;
}

/**
 * Everything interpolated into the email below goes through this first.
 *
 * The values are entry descriptions, task names and VA names typed by staff.
 * None of it is trusted as markup: a description containing "<b>" has to
 * arrive at the client as the characters they typed, not as an instruction to
 * the mail client.
 */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "22–28 Sep 2026", collapsing the month and year when the week doesn't straddle them. */
function formatWeekLabel(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86400000);
  const day = (d: Date) => d.getUTCDate();
  const monthYear = (d: Date) =>
    d.toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
  const month = (d: Date) => d.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${day(start)}–${day(end)} ${monthYear(end)}`;
  }
  return `${day(start)} ${month(start)} – ${day(end)} ${monthYear(end)}`;
}

const formatHours = (hours: number) => `${hours.toFixed(2)}h`;

/**
 * Table-based, inline-styled HTML on purpose: this is the one email in this
 * app that goes to someone outside the company, on an unknown mail client,
 * and Outlook still ignores most stylesheets. No images and no links, so
 * nothing needs to load for the report to be readable.
 */
function renderEmail(report: Report, senderName: string | undefined) {
  const weekLabel = formatWeekLabel(report.week_start);
  const greeting = report.contact_name?.trim()
    ? `Hi ${escapeHtml(report.contact_name.trim())},`
    : "Hello,";
  const cell = "padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;";
  const head = "padding:6px 10px;border-bottom:2px solid #111827;font-size:12px;text-align:left;";

  const rows = report.lines
    .map(
      (line) =>
        `<tr>` +
        `<td style="${cell}white-space:nowrap;">${escapeHtml(formatDate(line.date))}</td>` +
        `<td style="${cell}">${escapeHtml(line.va)}</td>` +
        `<td style="${cell}">${escapeHtml(line.task)}</td>` +
        `<td style="${cell}">${escapeHtml(line.description)}</td>` +
        `<td style="${cell}text-align:right;white-space:nowrap;">${formatHours(Number(line.hours))}</td>` +
        `</tr>`,
    )
    .join("");

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:720px;">` +
    `<p>${greeting}</p>` +
    `<p>Here is your casual service summary for ${escapeHtml(weekLabel)} — ` +
    `${report.line_count} ${report.line_count === 1 ? "task" : "tasks"}, ` +
    `${formatHours(Number(report.billed_hours))} in total.</p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">` +
    `<thead><tr>` +
    `<th style="${head}">Date</th>` +
    `<th style="${head}">Who</th>` +
    `<th style="${head}">Task</th>` +
    `<th style="${head}">Details</th>` +
    `<th style="${head}text-align:right;">Hours</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `<tfoot><tr>` +
    `<td colspan="4" style="${cell}font-weight:bold;">Total</td>` +
    `<td style="${cell}text-align:right;font-weight:bold;white-space:nowrap;">${formatHours(Number(report.billed_hours))}</td>` +
    `</tr></tfoot>` +
    `</table>` +
    `<p style="font-size:13px;color:#4b5563;">Hours shown are the hours billed for this work. ` +
    `Reply to this email if anything looks wrong and we'll check it.</p>` +
    `<p style="font-size:13px;color:#4b5563;">Thanks,<br />${escapeHtml(senderName ?? "The team")}</p>` +
    `</div>`;

  return {
    subject: `Casual service report — ${report.client_name}, ${weekLabel}`,
    html,
  };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  let clientId: string | undefined;
  let weekStart: string | undefined;
  let preview = false;
  try {
    const body = await req.json();
    clientId = body?.client_id;
    weekStart = body?.week_start;
    preview = body?.preview === true;
  } catch {
    // handled by the check below
  }
  if (!clientId || !weekStart) {
    return json({ error: "client_id and week_start are required" }, 400);
  }

  const from = FROM_ADDRESS_RAW ? parseFromAddress(FROM_ADDRESS_RAW) : null;
  // Checked before composing anything, even for a preview: a manager who is
  // about to promise a client a weekly email should find out now that this
  // deployment can't send one, not after clicking Send.
  if (!SENDGRID_API_KEY || !from) {
    console.log(
      `notify-casual-report: not configured (SENDGRID_API_KEY ${SENDGRID_API_KEY ? "set" : "MISSING"}, NOTIFY_FROM_ADDRESS ${from ? "set" : "MISSING or unparseable"})`,
    );
    return json({ error: "Email isn't configured for this workspace yet." }, 503);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.rpc("casual_report_for_client", {
    _client_id: clientId,
    _week_start: weekStart,
  });
  if (error) {
    // Every refusal in the RPC raises with a specific message ("No contact
    // email on file for …", "No casual service work is logged for …") — pass
    // it straight through so the manager sees the actual reason.
    console.error(`notify-casual-report: RPC refused for ${clientId}/${weekStart}:`, error.message);
    return json({ error: error.message }, 400);
  }

  const report = (data as Report[] | null)?.[0];
  if (!report) {
    console.error(`notify-casual-report: RPC returned no report for ${clientId}/${weekStart}`);
    return json({ error: "There's nothing to send for that week." }, 400);
  }

  const { subject, html } = renderEmail(report, from.name);

  if (preview) {
    return json(
      {
        preview: true,
        to: report.recipient_email,
        contact_name: report.contact_name,
        subject,
        html,
        line_count: report.line_count,
        billed_hours: Number(report.billed_hours),
        previous_sends: report.previous_sends ?? [],
      },
      200,
    );
  }

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [
              {
                email: report.recipient_email,
                name: report.contact_name?.trim() || undefined,
              },
            ],
            subject,
          },
        ],
        from,
        content: [{ type: "text/html", value: html }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `notify-casual-report: SendGrid rejected ${report.recipient_email} (${res.status}): ${body}`,
      );
      return json({ error: "The report couldn't be delivered." }, 502);
    }
  } catch (err) {
    console.error(
      `notify-casual-report: fetch to SendGrid failed for ${report.recipient_email}:`,
      err,
    );
    return json({ error: "The report couldn't be delivered." }, 502);
  }

  // Sent. Record it — and if *this* fails, still report success, because the
  // client has the email either way and telling the manager otherwise would
  // invite a second send. The error lands in the function logs instead.
  const { error: logError } = await supabase.rpc("record_casual_report_email", {
    _client_id: clientId,
    _week_start: weekStart,
    _recipient: report.recipient_email,
    _line_count: report.line_count,
    _billed_hours: report.billed_hours,
  });
  if (logError) {
    console.error(
      `notify-casual-report: sent to ${report.recipient_email} but could not record it:`,
      logError.message,
    );
  }

  console.log(
    `notify-casual-report: sent ${report.client_name}/${weekStart} to ${report.recipient_email}`,
  );
  return json({ sent: 1, to: report.recipient_email, recorded: !logError }, 200);
});
