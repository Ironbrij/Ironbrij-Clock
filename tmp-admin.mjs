import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false } });
const [cmd] = process.argv.slice(2);
if (cmd === "setup") {
  const inv = await admin.auth.admin.inviteUserByEmail("it@ironbrij.com.au");
  console.log("invite:", inv.error?.message ?? inv.data.user.id);
  if (inv.data?.user) {
    await admin.from("profiles").upsert({ id: inv.data.user.id, email: "it@ironbrij.com.au", full_name: "Ironbrij IT", job_title: "Workspace admin", role: "admin", is_pending: true });
  }
  const t = await admin.auth.admin.createUser({ email: "qa.check@ironbrij.com", password: "TempCheck!2026x", email_confirm: true });
  console.log("test user:", t.error?.message ?? t.data.user.id);
  if (t.data?.user) {
    await admin.from("profiles").upsert({ id: t.data.user.id, email: "qa.check@ironbrij.com", full_name: "QA Check", job_title: "Verification", role: "admin" });
    const { data: team } = await admin.from("teams").select("id").limit(1).single();
    if (team) await admin.from("team_members").upsert({ user_id: t.data.user.id, team_id: team.id });
  }
}
if (cmd === "cleanup") {
  const { data } = await admin.auth.admin.listUsers();
  const u = data.users.find((x) => x.email === "qa.check@ironbrij.com");
  if (u) {
    await admin.from("profiles").delete().eq("id", u.id);
    console.log("deleted:", (await admin.auth.admin.deleteUser(u.id)).error?.message ?? "ok");
  }
}
