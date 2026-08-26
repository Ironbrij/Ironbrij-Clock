// M29 (docs/audit-findings.md): minimal, real email delivery for the one
// notification the audit recommended building first — "a timesheet is
// waiting on your review." Deliberately scoped to just this one case, not
// a general notification system; every other item in Settings >
// Notifications stays mocked, per the audit's own recommendation.
//
// Called client-side right after submitTimesheet() succeeds
// (src/lib/workspace/use-timesheets.ts) — best-effort, fire-and-forget: a
// failure here never blocks or fails the submit itself.
//
// Runs as the *caller*, not service role: the incoming Authorization
// header is forwarded straight through to the Supabase client below, so
// RLS plus timesheet_submission_recipients()'s own ownership check (it
// only ever returns recipients for a timesheet the caller actually owns
// and actually just submitted) are what keep this safe — not this
// function's privilege level. See that RPC's own migration
// (20260825090000_timesheet_submission_recipients.sql) for the full
// reasoning.
//
// Sends via Ironbrij's own SendGrid account (switched from an initial
// Resend build 2026-08-26, before Resend was ever deployed — Louis wanted
// the existing SendGrid account used instead of standing up a new
// provider). Requires two secrets set on the project — NOT set by this
// commit, since this environment has no way to configure them:
//   supabase secrets set SENDGRID_API_KEY=<your SendGrid API key>
//   supabase secrets set NOTIFY_FROM_ADDRESS='IronTrack <notifications@yourdomain>'
// Unlike Resend, SendGrid has no free unverified-domain test sender to
// fall back to — NOTIFY_FROM_ADDRESS must be an address covered by a
// verified Single Sender or authenticated domain in the SendGrid account,
// or every send will be rejected. With no default to silently fall back
// on, this is a hard requirement: this function no-ops (rather than
// sending from an address that will just bounce) until it's set. Deploy
// with: supabase functions deploy notify-timesheet-submitted
//
// Without SENDGRID_API_KEY or NOTIFY_FROM_ADDRESS set, this is a no-op
// (200, { sent: 0 }) rather than an error — matches this being an
// acceptable v1 scope cut, not a hard requirement, per the audit's own
// framing.

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

type Recipient = {
  email: string;
  full_name: string | null;
  week_start: string;
  submitter_name: string | null;
};

function formatWeekLabel(weekStart: string) {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
    });
  }

  let timesheetId: string | undefined;
  try {
    const body = await req.json();
    timesheetId = body?.timesheet_id;
  } catch {
    // handled by the check below
  }
  if (!timesheetId) {
    return new Response(JSON.stringify({ error: "timesheet_id is required" }), { status: 400 });
  }

  const from = FROM_ADDRESS_RAW ? parseFromAddress(FROM_ADDRESS_RAW) : null;
  if (!SENDGRID_API_KEY || !from) {
    console.log(
      `notify-timesheet-submitted: not configured (SENDGRID_API_KEY ${SENDGRID_API_KEY ? "set" : "MISSING"}, NOTIFY_FROM_ADDRESS ${from ? "set" : "MISSING or unparseable"})`,
    );
    return new Response(JSON.stringify({ sent: 0, reason: "not configured" }), { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: recipients, error } = await supabase.rpc("timesheet_submission_recipients", {
    _timesheet_id: timesheetId,
  });
  if (error) {
    console.error(
      `notify-timesheet-submitted: RPC error for timesheet ${timesheetId}:`,
      error.message,
    );
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
  if (!recipients || recipients.length === 0) {
    console.log(
      `notify-timesheet-submitted: 0 recipients for timesheet ${timesheetId} (no other admin/manager to notify)`,
    );
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }
  console.log(
    `notify-timesheet-submitted: ${recipients.length} recipient(s) for timesheet ${timesheetId}: ${(recipients as Recipient[]).map((r) => r.email).join(", ")}`,
  );

  const first = recipients[0] as Recipient;
  const who = first.submitter_name || "Someone";
  const weekLabel = formatWeekLabel(first.week_start);

  let sent = 0;
  for (const r of recipients as Recipient[]) {
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
              to: [{ email: r.email, name: r.full_name || undefined }],
              subject: `${who} submitted their timesheet for review`,
            },
          ],
          from,
          content: [
            {
              type: "text/html",
              value: `<p>Hi ${r.full_name || "there"},</p><p><strong>${who}</strong> just submitted their timesheet for the week of ${weekLabel}. It's waiting on your review in IronTrack.</p>`,
            },
          ],
        }),
      });
      // SendGrid returns 202 Accepted with an empty body on success.
      if (res.ok) {
        sent++;
        console.log(`notify-timesheet-submitted: sent to ${r.email} (${res.status})`);
      } else {
        const body = await res.text().catch(() => "");
        console.error(
          `notify-timesheet-submitted: SendGrid rejected ${r.email} (${res.status}): ${body}`,
        );
      }
    } catch (err) {
      // Best-effort per recipient — one failed send shouldn't stop the rest.
      console.error(`notify-timesheet-submitted: fetch to SendGrid failed for ${r.email}:`, err);
    }
  }

  console.log(
    `notify-timesheet-submitted: done, ${sent}/${(recipients as Recipient[]).length} sent`,
  );
  return new Response(JSON.stringify({ sent }), { status: 200 });
});
