// Announcements: real email delivery for a posted announcement, reusing
// the exact SendGrid path M29 built for notify-timesheet-submitted —
// same header-forwarding (runs as the caller, not service role), same
// CORS/OPTIONS handling, same "no-op rather than error" fallback when
// SENDGRID_API_KEY/NOTIFY_FROM_ADDRESS aren't configured. See that
// function's own header comment (supabase/functions/
// notify-timesheet-submitted/index.ts) for the full reasoning behind
// each of those choices — not repeated here.
//
// Called client-side right after create_announcement() succeeds
// (src/lib/workspace/use-announcements.ts) — best-effort, fire-and-forget:
// a failure here never blocks or fails the post itself.
//
// One real difference from notify-timesheet-submitted: that function only
// ever emails a handful of reviewers, so it fires one fetch per recipient.
// An announcement can target the whole company, so this batches instead —
// SendGrid accepts up to 1000 `personalizations` per request, each with
// its own `to`, so recipients are chunked well under that limit and sent
// as one request per chunk rather than one request per person.
//
// Deploy with: supabase functions deploy notify-announcement-posted

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

// SendGrid's own cap is 1000 personalizations/request — chunking well
// under that keeps each request comfortably sized and means one slow/
// failed chunk doesn't risk the whole batch timing out.
const CHUNK_SIZE = 500;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Recipient = {
  email: string;
  full_name: string | null;
  title: string;
  body: string;
  author_name: string | null;
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

// title/body are user-authored free text (unlike M29's trusted display
// names), so they're escaped before landing in the HTML email body.
function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// title/body/author_name are the same for every recipient of one
// announcement — only the greeting name varies per person. Rather than
// re-rendering (and re-escaping) the whole body once per recipient, the
// content is built once per chunk with a "-name-" placeholder, and each
// personalization supplies its own substitution for it (SendGrid's legacy
// substitution-tag mechanism) — avoids the bug a naive "render off the
// first recipient in the chunk" approach would have, where everyone in a
// chunk sees the first person's name in their own greeting.
function renderBodyTemplate(r: Pick<Recipient, "title" | "body" | "author_name">) {
  const who = r.author_name || "Someone";
  const paragraphs = r.body
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  return `<p>Hi -name-,</p><p><strong>${escapeHtml(who)}</strong> posted a new announcement in IronTrack: <strong>${escapeHtml(r.title)}</strong></p>${paragraphs}`;
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

  let announcementId: string | undefined;
  try {
    const body = await req.json();
    announcementId = body?.announcement_id;
  } catch {
    // handled by the check below
  }
  if (!announcementId) {
    return json({ error: "announcement_id is required" }, 400);
  }

  const from = FROM_ADDRESS_RAW ? parseFromAddress(FROM_ADDRESS_RAW) : null;
  if (!SENDGRID_API_KEY || !from) {
    console.log(
      `notify-announcement-posted: not configured (SENDGRID_API_KEY ${SENDGRID_API_KEY ? "set" : "MISSING"}, NOTIFY_FROM_ADDRESS ${from ? "set" : "MISSING or unparseable"})`,
    );
    return json({ sent: 0, reason: "not configured" }, 200);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: recipients, error } = await supabase.rpc("announcement_recipients", {
    _announcement_id: announcementId,
  });
  if (error) {
    console.error(
      `notify-announcement-posted: RPC error for announcement ${announcementId}:`,
      error.message,
    );
    return json({ error: error.message }, 400);
  }
  if (!recipients || recipients.length === 0) {
    console.log(`notify-announcement-posted: 0 recipients for announcement ${announcementId}`);
    return json({ sent: 0 }, 200);
  }
  console.log(
    `notify-announcement-posted: ${recipients.length} recipient(s) for announcement ${announcementId}`,
  );

  let sent = 0;
  const rows = recipients as Recipient[];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: chunk.map((r) => ({
            to: [{ email: r.email, name: r.full_name || undefined }],
            subject: `New announcement: ${r.title}`,
            substitutions: { "-name-": r.full_name || "there" },
          })),
          from,
          content: [{ type: "text/html", value: renderBodyTemplate(chunk[0]) }],
        }),
      });
      // SendGrid returns 202 Accepted with an empty body on success.
      if (res.ok) {
        sent += chunk.length;
        console.log(`notify-announcement-posted: sent chunk of ${chunk.length} (${res.status})`);
      } else {
        const body = await res.text().catch(() => "");
        console.error(
          `notify-announcement-posted: SendGrid rejected a chunk of ${chunk.length} (${res.status}): ${body}`,
        );
      }
    } catch (err) {
      // Best-effort per chunk — one failed chunk shouldn't stop the rest.
      console.error(`notify-announcement-posted: fetch to SendGrid failed for a chunk:`, err);
    }
  }

  console.log(`notify-announcement-posted: done, ${sent}/${rows.length} sent`);
  return json({ sent }, 200);
});
