import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(25),
  teamId: z.string().uuid().nullable().optional(),
  role: z.enum(["admin", "manager", "member"]).default("member"),
  redirectTo: z.string().url().optional(),
});

export const inviteMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Only admins can invite people");

    // No domain restriction here on purpose — an admin explicitly typing
    // this exact address IS the security control (paired with the
    // "Before User Created" hook, which blocks anyone who tries to sign
    // up on their own without having been invited first).
    const emails = data.emails.map((e) => e.trim().toLowerCase());

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const failures: { email: string; reason: string }[] = [];
    let invited = 0;

    for (const email of emails) {
      const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: data.redirectTo,
        data: { invited_by_admin: true },
      });
      if (error || !created?.user) {
        failures.push({ email, reason: error?.message ?? "Unknown error" });
        continue;
      }
      const userId = created.user.id;
      await supabaseAdmin.from("profiles").upsert({
        id: userId,
        email,
        full_name: email.replace(/@.*$/, "").replace(/[._-]+/g, " "),
        job_title: "Invited — awaiting sign-up",
        role: data.role,
        is_pending: true,
      });
      if (data.teamId) {
        await supabaseAdmin
          .from("team_members")
          .upsert({ user_id: userId, team_id: data.teamId }, { onConflict: "user_id,team_id" });
      }
      invited += 1;
    }

    if (invited === 0) {
      const reasons = failures.map((f) => `${f.email}: ${f.reason}`).join("; ");
      throw new Error(`No invites could be sent — ${reasons}`);
    }
    return { invited, failures: failures.map((f) => f.email) };
  });

const resendSchema = z.object({
  email: z.string().email(),
});

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Only admins can resend invites");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up the existing user by email first
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw new Error(listError.message);

    const existing = users.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
    if (!existing) {
      throw new Error("No account found for that email — invite them first.");
    }

    // Generate a new magic link for the existing user
    const { error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: data.email,
    });
    if (linkError) throw new Error(linkError.message);

    return { sent: true };
  });
