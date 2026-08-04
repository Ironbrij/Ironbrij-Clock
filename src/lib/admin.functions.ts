import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inviteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(25),
  teamId: z.string().uuid().nullable().optional(),
  role: z.enum(["admin", "manager", "member"]).default("member"),
  redirectTo: z.string().url().optional(),
});

const allowedDomains = ["ironbrij.com", "ironbrij.com.au"];

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

    const emails = data.emails
      .map((e) => e.trim().toLowerCase())
      .filter((e) => allowedDomains.includes(e.split("@")[1] ?? ""));
    if (emails.length === 0) {
      throw new Error(`Invites are limited to ${allowedDomains.map((d) => "@" + d).join(" and ")} addresses`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const failures: string[] = [];
    let invited = 0;

    for (const email of emails) {
      const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: data.redirectTo,
      });
      if (error || !created?.user) {
        failures.push(email);
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

    if (invited === 0) throw new Error("No invites could be sent — those addresses may already exist.");
    return { invited, failures };
  });
