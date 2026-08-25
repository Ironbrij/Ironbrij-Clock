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
// Requires two secrets set on the project — NOT set by this commit, since
// this environment has no way to configure them:
//   supabase secrets set RESEND_API_KEY=<your Resend API key>
//   supabase secrets set NOTIFY_FROM_ADDRESS='IronTrack <notifications@yourdomain>'
// NOTIFY_FROM_ADDRESS is optional — without it, this falls back to
// Resend's own onboarding@resend.dev test sender, which works with no
// domain verification but is rate-limited and only deliverable to the
// Resend account's own verified email during testing. A real launch needs
// a verified sending domain and NOTIFY_FROM_ADDRESS set to an address on
// it. Deploy with: supabase functions deploy notify-timesheet-submitted
//
// Without RESEND_API_KEY set, this is a no-op (200, { sent: 0 }) rather
// than an error — matches this being an acceptable v1 scope cut, not a
// hard requirement, per the audit's own framing.

// @ts-expect-error Deno-only global, not available in this repo's Node/tsc typecheck
import { createClient } from "npm:@supabase/supabase-js@2";

// @ts-expect-error Deno global
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-expect-error Deno global
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// @ts-expect-error Deno global
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS =
  // @ts-expect-error Deno global
  Deno.env.get("NOTIFY_FROM_ADDRESS") ?? "IronTrack <onboarding@resend.dev>";

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

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ sent: 0, reason: "not configured" }), { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: recipients, error } = await supabase.rpc("timesheet_submission_recipients", {
    _timesheet_id: timesheetId,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
  if (!recipients || recipients.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const first = recipients[0] as Recipient;
  const who = first.submitter_name || "Someone";
  const weekLabel = formatWeekLabel(first.week_start);

  let sent = 0;
  for (const r of recipients as Recipient[]) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [r.email],
          subject: `${who} submitted their timesheet for review`,
          html: `<p>Hi ${r.full_name || "there"},</p><p><strong>${who}</strong> just submitted their timesheet for the week of ${weekLabel}. It's waiting on your review in IronTrack.</p>`,
        }),
      });
      if (res.ok) sent++;
    } catch {
      // Best-effort per recipient — one failed send shouldn't stop the rest.
    }
  }

  return new Response(JSON.stringify({ sent }), { status: 200 });
});
