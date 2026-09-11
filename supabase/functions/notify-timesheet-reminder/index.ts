// M47: "you haven't submitted your timesheet yet" — sent when a manager
// clicks Remind in Manage → Approvals' submission status panel. Manual
// only: there is no schedule behind this, every send is a manager acting
// on a specific person and week.
//
// Closely modelled on notify-timesheet-submitted (M29) — same SendGrid
// account, same secrets, same caller-privilege approach. Read that
// function's header first; the reasoning below only covers what differs.
//
// Runs as the *caller*, not service role: the incoming Authorization
// header is forwarded to the Supabase client, so who may remind whom is
// decided by request_timesheet_reminder()'s own checks (manager/admin,
// same team, not already submitted, not already reminded this week), not
// by this function's privilege level. See
// 20260911000000_timesheet_reminders.sql.
//
// That RPC also *records* the reminder, so calling this function is what
// consumes the one-per-person-per-week allowance — not the SendGrid call
// below. A send failure therefore still burns the allowance; that's the
// deliberate trade-off documented in the migration. It's also why this
// function reports a failed send as a non-2xx rather than swallowing it
// like the fire-and-forget submit notification does: the manager needs to
// know the email didn't go, because they can't simply click again.
//
// Requires the same two secrets as notify-timesheet-submitted
// (SENDGRID_API_KEY, NOTIFY_FROM_ADDRESS) and no-ops without them.
// Deploy with: supabase functions deploy notify-timesheet-reminder

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

type Recipient = {
  email: string;
  full_name: string | null;
  week_start: string;
  manager_name: string | null;
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

  let userId: string | undefined;
  let weekStart: string | undefined;
  try {
    const body = await req.json();
    userId = body?.user_id;
    weekStart = body?.week_start;
  } catch {
    // handled by the check below
  }
  if (!userId || !weekStart) {
    return json({ error: "user_id and week_start are required" }, 400);
  }

  const from = FROM_ADDRESS_RAW ? parseFromAddress(FROM_ADDRESS_RAW) : null;
  // Checked before the RPC deliberately: the RPC records the reminder and
  // burns this week's one allowed send, so it must not run at all if there
  // is no way to actually deliver the email.
  if (!SENDGRID_API_KEY || !from) {
    console.log(
      `notify-timesheet-reminder: not configured (SENDGRID_API_KEY ${SENDGRID_API_KEY ? "set" : "MISSING"}, NOTIFY_FROM_ADDRESS ${from ? "set" : "MISSING or unparseable"})`,
    );
    return json({ sent: 0, reason: "not configured" }, 200);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.rpc("request_timesheet_reminder", {
    _user_id: userId,
    _week_start: weekStart,
  });
  if (error) {
    // Every refusal in the RPC raises with a specific message ("already
    // been reminded", "already submitted", wrong team, ...) — pass it
    // straight through so the manager sees the actual reason.
    console.error(
      `notify-timesheet-reminder: RPC refused for ${userId}/${weekStart}:`,
      error.message,
    );
    return json({ error: error.message }, 400);
  }

  const recipient = (data as Recipient[] | null)?.[0];
  if (!recipient) {
    console.error(
      `notify-timesheet-reminder: RPC returned no recipient for ${userId}/${weekStart}`,
    );
    return json({ error: "No one to remind." }, 400);
  }

  const weekLabel = formatWeekLabel(recipient.week_start);
  const who = recipient.full_name || "there";
  const manager = recipient.manager_name || "Your manager";

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
            to: [{ email: recipient.email, name: recipient.full_name || undefined }],
            subject: `Your timesheet for ${weekLabel} isn't submitted yet`,
          },
        ],
        from,
        content: [
          {
            type: "text/html",
            value:
              `<p>Hi ${who},</p>` +
              `<p>${manager} noticed your timesheet for the week of ${weekLabel} hasn't been submitted yet.</p>` +
              `<p>When you get a moment, head to IronTrack, check the week looks right, and hit Submit.</p>`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `notify-timesheet-reminder: SendGrid rejected ${recipient.email} (${res.status}): ${body}`,
      );
      return json({ error: "The reminder couldn't be delivered." }, 502);
    }
    console.log(`notify-timesheet-reminder: sent to ${recipient.email} (${res.status})`);
    return json({ sent: 1 }, 200);
  } catch (err) {
    console.error(
      `notify-timesheet-reminder: fetch to SendGrid failed for ${recipient.email}:`,
      err,
    );
    return json({ error: "The reminder couldn't be delivered." }, 502);
  }
});
