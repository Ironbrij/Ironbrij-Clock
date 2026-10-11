// M43: integration tests against the highest-stakes `SECURITY DEFINER`
// Postgres functions this document's own audits kept having to re-verify
// by hand — submit_timesheet(), review_timesheet(), set_member_role().
// Deliberately not exhaustive coverage (see the audit's own "Recommended
// action": "not a call to build exhaustive coverage") — one happy path plus
// the specific business rule each function is known for in this repo's
// history: the running-timer/empty-week/already-submitted guards on
// submit_timesheet, the self-review block on review_timesheet, and the
// last-remaining-admin protection on set_member_role.
//
// Needs a real Postgres+Auth instance with every migration under
// supabase/migrations/ applied — `npm run test` alone can't provide that,
// so this whole file no-ops (skipped, not failed) unless
// TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY/TEST_SUPABASE_SERVICE_ROLE_KEY
// are set. Run locally with the Supabase CLI (`supabase start`, which needs
// Docker) or let CI do it — see .github/workflows/ci.yml, which starts a
// throwaway local instance for exactly this file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const hasLocalSupabase = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

if (!hasLocalSupabase) {
  // A file with zero registered tests is a vitest error ("No test suite
  // found"), not a pass — so the no-database case still needs one (skipped)
  // test to make that a clean, visible skip instead of a build failure.
  describe.skip("SECURITY DEFINER RPCs (M43)", () => {
    it("needs TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY/TEST_SUPABASE_SERVICE_ROLE_KEY — see file header", () => {});
  });
}

const RPC_TIMEOUT = 20_000;
const noAuthRefresh = { auth: { autoRefreshToken: false, persistSession: false } };

/** A fresh client signed in as one fixture user — used for the RPC calls under test, never for setup (setup goes through the service-role client, same as real fixture data never goes through the app's own RLS-scoped path either). */
async function signedInClient(userId: string, email: string, password: string) {
  const client = createClient<Database>(SUPABASE_URL!, ANON_KEY!, noAuthRefresh);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { userId, client };
}

// Mid-week, comfortably clear of any day-boundary/timezone-conversion edge —
// compute_time_entry_date() (M36) derives entry_date from this converted
// through the fixture profile's timezone (left at the default
// 'Australia/Sydney'), and 04:00 UTC lands mid-afternoon there regardless of
// AEST/AEDT.
function thisWeekWednesdayUtc(): { weekStartDate: string; entryStart: Date; entryEnd: Date } {
  const now = new Date();
  const dayIndex = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayIndex),
  );
  const entryStart = new Date(monday.getTime() + 2 * 86_400_000 + 4 * 3_600_000); // Wed 04:00 UTC
  const entryEnd = new Date(entryStart.getTime() + 3_600_000);
  return { weekStartDate: monday.toISOString().slice(0, 10), entryStart, entryEnd };
}

// A plain `if` around the whole describe — not describe.skipIf — because
// skipIf still executes the describe callback body (including the
// createClient() call below) to register its tests; it only skips running
// them. With no URL/keys configured, that createClient() call throws before
// skipping ever gets a chance to matter.
if (hasLocalSupabase) {
  describe("SECURITY DEFINER RPCs (M43): submit_timesheet / review_timesheet / set_member_role", () => {
    const admin: SupabaseClient<Database> = createClient<Database>(
      SUPABASE_URL!,
      SERVICE_ROLE_KEY!,
      noAuthRefresh,
    );
    const suffix = Math.random().toString(36).slice(2, 8);
    const password = "Test-password-1234!";
    const createdUserIds: string[] = [];
    let teamId: string;

    /** Approved unless `pending` — like every account actually in use, since AppShell blocks pending ones and has_role()/can_manage() ignore them. */
    async function fixtureUser(
      label: string,
      role: "admin" | "manager" | "member",
      { pending = false }: { pending?: boolean } = {},
    ) {
      const email = `${label}-${suffix}@rpc-test.ironbrij.local`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser(${email}) failed: ${error?.message}`);
      const userId = data.user.id;
      createdUserIds.push(userId);
      const { error: profileError } = await admin.from("profiles").upsert({
        id: userId,
        email,
        full_name: label,
        role,
        is_active: true,
        is_pending: pending,
      });
      if (profileError)
        throw new Error(`profile upsert failed for ${email}: ${profileError.message}`);
      return signedInClient(userId, email, password);
    }

    let adminUser: Awaited<ReturnType<typeof fixtureUser>>;
    let managerUser: Awaited<ReturnType<typeof fixtureUser>>;
    let memberUser: Awaited<ReturnType<typeof fixtureUser>>;
    let outsideManagerUser: Awaited<ReturnType<typeof fixtureUser>>;

    beforeAll(async () => {
      const { data: team, error: teamError } = await admin
        .from("teams")
        .insert({ name: `RPC test team ${suffix}` })
        .select("id")
        .single();
      if (teamError || !team) throw new Error(`team insert failed: ${teamError?.message}`);
      teamId = team.id;

      adminUser = await fixtureUser("admin", "admin");
      managerUser = await fixtureUser("manager", "manager");
      memberUser = await fixtureUser("member", "member");
      outsideManagerUser = await fixtureUser("outside-manager", "manager");

      const { error: teamMembersError } = await admin.from("team_members").insert([
        { user_id: managerUser.userId, team_id: teamId },
        { user_id: memberUser.userId, team_id: teamId },
      ]);
      if (teamMembersError)
        throw new Error(`team_members insert failed: ${teamMembersError.message}`);
    }, RPC_TIMEOUT);

    afterAll(async () => {
      // Best-effort — this runs against a throwaway local instance in CI
      // anyway, but cleans up nicely for anyone running this against a
      // persistent local `supabase start` too.
      for (const userId of createdUserIds) {
        await admin.from("time_entries").delete().eq("user_id", userId);
        await admin.from("timesheets").delete().eq("user_id", userId);
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        await admin.from("profiles").delete().eq("id", userId);
      }
      if (teamId) await admin.from("teams").delete().eq("id", teamId);
    }, RPC_TIMEOUT);

    describe("submit_timesheet", () => {
      it(
        "rejects submitting a week with no logged entries",
        async () => {
          const { weekStartDate } = thisWeekWednesdayUtc();
          const { error } = await memberUser.client.rpc("submit_timesheet", {
            _week_start: weekStartDate,
          });
          expect(error?.message).toMatch(/log some time/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "rejects submitting a week with a still-running timer",
        async () => {
          const { weekStartDate, entryStart } = thisWeekWednesdayUtc();
          const { error: insertError } = await admin.from("time_entries").insert({
            user_id: memberUser.userId,
            start_time: entryStart.toISOString(),
            end_time: null,
          });
          expect(insertError).toBeNull();

          const { error } = await memberUser.client.rpc("submit_timesheet", {
            _week_start: weekStartDate,
          });
          expect(error?.message).toMatch(/running timer/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "submits successfully once there's a completed entry and no running timer, then blocks re-submitting",
        async () => {
          const { weekStartDate, entryStart, entryEnd } = thisWeekWednesdayUtc();
          await admin
            .from("time_entries")
            .delete()
            .eq("user_id", memberUser.userId)
            .is("end_time", null);
          const { error: insertError } = await admin.from("time_entries").insert({
            user_id: memberUser.userId,
            start_time: entryStart.toISOString(),
            end_time: entryEnd.toISOString(),
          });
          expect(insertError).toBeNull();

          const { data, error } = await memberUser.client.rpc("submit_timesheet", {
            _week_start: weekStartDate,
          });
          expect(error).toBeNull();
          expect(data?.status).toBe("submitted");

          const { error: resubmitError } = await memberUser.client.rpc("submit_timesheet", {
            _week_start: weekStartDate,
          });
          expect(resubmitError?.message).toMatch(/already been submitted/i);
        },
        RPC_TIMEOUT,
      );
    });

    describe("review_timesheet", () => {
      it(
        "blocks the submitter from reviewing their own timesheet",
        async () => {
          const { data: sheet } = await admin
            .from("timesheets")
            .select("id")
            .eq("user_id", memberUser.userId)
            .eq("status", "submitted")
            .single();
          expect(sheet).toBeTruthy();

          const { error } = await memberUser.client.rpc("review_timesheet", {
            _timesheet_id: sheet!.id,
            _status: "approved",
          });
          expect(error?.message).toMatch(/cannot review your own timesheet/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "blocks a manager with no shared team from reviewing it",
        async () => {
          const { data: sheet } = await admin
            .from("timesheets")
            .select("id")
            .eq("user_id", memberUser.userId)
            .eq("status", "submitted")
            .single();

          const { error } = await outsideManagerUser.client.rpc("review_timesheet", {
            _timesheet_id: sheet!.id,
            _status: "approved",
          });
          expect(error?.message).toMatch(/admin.*manager who shares a team/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "lets a manager sharing a team approve it, then blocks reviewing it again",
        async () => {
          const { data: sheet } = await admin
            .from("timesheets")
            .select("id")
            .eq("user_id", memberUser.userId)
            .eq("status", "submitted")
            .single();

          const { data, error } = await managerUser.client.rpc("review_timesheet", {
            _timesheet_id: sheet!.id,
            _status: "approved",
          });
          expect(error).toBeNull();
          expect(data?.status).toBe("approved");

          const { error: secondReviewError } = await adminUser.client.rpc("review_timesheet", {
            _timesheet_id: sheet!.id,
            _status: "rejected",
          });
          expect(secondReviewError?.message).toMatch(/not found or not awaiting review/i);
        },
        RPC_TIMEOUT,
      );
    });

    describe("set_member_role", () => {
      // "blocks demoting the last remaining admin" below only means what it
      // says if adminUser genuinely *is* the last one — but a fresh
      // migration replay always seeds a permanent demo admin
      // (maya@ironbrij.com, 20260804000910_...sql), so without this,
      // set_member_role correctly sees a second active admin and doesn't
      // block, which then cascades into the next test failing too (it
      // assumes adminUser is still an admin). Deactivating every
      // *other* active admin for the duration of this describe block
      // (never our own fixtures) makes the premise true regardless of
      // what demo/seed data exists, and restores it afterward — safe even
      // against a persistent local `supabase start`, not just CI's
      // throwaway instance.
      let deactivatedOtherAdminIds: string[] = [];

      beforeAll(async () => {
        const { data: otherAdmins, error } = await admin
          .from("profiles")
          .select("id")
          .eq("role", "admin")
          .eq("is_active", true)
          .not("id", "in", `(${createdUserIds.join(",")})`);
        if (error) throw new Error(`fetching other admins failed: ${error.message}`);
        deactivatedOtherAdminIds = (otherAdmins ?? []).map((p) => p.id);
        if (deactivatedOtherAdminIds.length > 0) {
          const { error: deactivateError } = await admin
            .from("profiles")
            .update({ is_active: false })
            .in("id", deactivatedOtherAdminIds);
          if (deactivateError)
            throw new Error(`deactivating other admins failed: ${deactivateError.message}`);
        }
      }, RPC_TIMEOUT);

      afterAll(async () => {
        if (deactivatedOtherAdminIds.length > 0) {
          await admin
            .from("profiles")
            .update({ is_active: true })
            .in("id", deactivatedOtherAdminIds);
        }
      }, RPC_TIMEOUT);

      it(
        "blocks a non-admin from changing anyone's role",
        async () => {
          const { error } = await managerUser.client.rpc("set_member_role", {
            _user_id: memberUser.userId,
            _role: "manager",
          });
          expect(error?.message).toMatch(/only admins can change roles/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "lets an admin change a member's role",
        async () => {
          const { error } = await adminUser.client.rpc("set_member_role", {
            _user_id: memberUser.userId,
            _role: "manager",
          });
          expect(error).toBeNull();

          const { data: profile } = await admin
            .from("profiles")
            .select("role")
            .eq("id", memberUser.userId)
            .single();
          expect(profile?.role).toBe("manager");
        },
        RPC_TIMEOUT,
      );

      it(
        "blocks demoting the last remaining admin",
        async () => {
          const { error } = await adminUser.client.rpc("set_member_role", {
            _user_id: adminUser.userId,
            _role: "member",
          });
          expect(error?.message).toMatch(/last remaining admin/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "allows demoting an admin once a second admin exists",
        async () => {
          const secondAdmin = await fixtureUser("second-admin", "admin");
          const { error } = await adminUser.client.rpc("set_member_role", {
            _user_id: secondAdmin.userId,
            _role: "member",
          });
          expect(error).toBeNull();

          const { data: profile } = await admin
            .from("profiles")
            .select("role")
            .eq("id", secondAdmin.userId)
            .single();
          expect(profile?.role).toBe("member");
        },
        RPC_TIMEOUT,
      );
    });

    // RLS audit 2026-10-11 (20261011000000_lock_down_profile_privileges.sql):
    // a profile's owner could write its role/is_active/is_pending/email
    // directly, so any non-admin could promote themselves and read every pay
    // rate. These go through the plain table API exactly as an attacker
    // would, never through the app's own hooks.
    describe("profiles privileged columns", () => {
      type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

      /** Signed in, but no profiles row yet — the state the first-sign-in bootstrap in use-members.ts starts from. */
      async function signedInWithoutProfile(label: string) {
        const email = `${label}-${suffix}@rpc-test.ironbrij.local`;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`createUser(${email}) failed: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { email, ...(await signedInClient(data.user.id, email, password)) };
      }

      it(
        "blocks inserting your own profile as an admin",
        async () => {
          const fresh = await signedInWithoutProfile("self-insert-admin");
          const { error } = await fresh.client.from("profiles").insert({
            id: fresh.userId,
            email: fresh.email,
            role: "admin",
            is_pending: false,
          });
          expect(error).not.toBeNull();

          const { data } = await admin.from("profiles").select("id").eq("id", fresh.userId);
          expect(data).toEqual([]);
        },
        RPC_TIMEOUT,
      );

      it(
        "blocks inserting your own profile under someone else's email",
        async () => {
          const fresh = await signedInWithoutProfile("self-insert-email");
          const { error } = await fresh.client.from("profiles").insert({
            id: fresh.userId,
            email: `not-me-${suffix}@example.com`,
            full_name: "Not me",
            is_pending: true,
          });
          expect(error?.message).toMatch(/must match the signed-in account/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "still lets a first sign-in create its own pending member profile",
        async () => {
          const fresh = await signedInWithoutProfile("self-insert-ok");
          const { error } = await fresh.client.from("profiles").insert({
            id: fresh.userId,
            email: fresh.email,
            full_name: "Bootstrap",
            avatar_url: null,
            job_title: "Team member",
            is_pending: true,
          });
          expect(error).toBeNull();

          const { data: profile } = await admin
            .from("profiles")
            .select("role, is_pending, is_active")
            .eq("id", fresh.userId)
            .single();
          expect(profile).toEqual({ role: "member", is_pending: true, is_active: true });
        },
        RPC_TIMEOUT,
      );

      it(
        "blocks a member from changing their own role, approval, active status or email",
        async () => {
          const member = await fixtureUser("self-escalate", "member", { pending: true });
          const patches: ProfileUpdate[] = [
            { role: "admin" },
            { role: "manager" },
            { is_pending: false },
            { is_active: false },
            { email: `hijack-${suffix}@example.com` },
          ];
          for (const patch of patches) {
            const { error } = await member.client
              .from("profiles")
              .update(patch)
              .eq("id", member.userId);
            expect(error, JSON.stringify(patch)).not.toBeNull();
          }

          const { data: profile } = await admin
            .from("profiles")
            .select("role, is_pending, is_active, email")
            .eq("id", member.userId)
            .single();
          expect(profile?.role).toBe("member");
          expect(profile?.is_pending).toBe(true);
          expect(profile?.is_active).toBe(true);
          expect(profile?.email).toMatch(/^self-escalate-/);
        },
        RPC_TIMEOUT,
      );

      it(
        "still lets a member edit their own name, job title and timezone",
        async () => {
          const member = await fixtureUser("self-edit", "member");
          const { data, error } = await member.client
            .from("profiles")
            .update({ full_name: "Edited", job_title: "VA", timezone: "Australia/Perth" })
            .eq("id", member.userId)
            .select("id");
          expect(error).toBeNull();
          expect(data).toHaveLength(1);
        },
        RPC_TIMEOUT,
      );

      it(
        "still lets an admin set another member's timezone and approve them",
        async () => {
          const member = await fixtureUser("admin-edits", "member", { pending: true });
          const { data, error } = await adminUser.client
            .from("profiles")
            .update({ timezone: "Australia/Brisbane" })
            .eq("id", member.userId)
            .select("id");
          expect(error).toBeNull();
          expect(data).toHaveLength(1);

          const { error: approveError } = await adminUser.client.rpc("approve_member", {
            _user_id: member.userId,
          });
          expect(approveError).toBeNull();

          const { data: profile } = await admin
            .from("profiles")
            .select("is_pending")
            .eq("id", member.userId)
            .single();
          expect(profile?.is_pending).toBe(false);
        },
        RPC_TIMEOUT,
      );
    });

    // System review 2026-10-11 (20261011010000_require_approval_for_reads.sql):
    // "pending" used to be enforced only by AppShell, so an account no admin
    // had approved could still read the directory, and one invited as a
    // manager could read payroll.
    describe("pending accounts", () => {
      it(
        "can read their own profile but not the directory",
        async () => {
          const pending = await fixtureUser("pending-reader", "member", { pending: true });

          const { data: profiles } = await pending.client.from("profiles").select("id");
          expect(profiles?.map((p) => p.id)).toEqual([pending.userId]);

          for (const table of ["teams", "team_members", "clients", "projects", "tags"] as const) {
            const { data, error } = await pending.client.from(table).select("*").limit(1);
            expect(error, table).toBeNull();
            expect(data, table).toEqual([]);
          }
        },
        RPC_TIMEOUT,
      );

      it(
        "can read the directory once approved",
        async () => {
          const { data: teams } = await memberUser.client
            .from("teams")
            .select("id")
            .eq("id", teamId);
          expect(teams).toHaveLength(1);

          const { data: profiles } = await memberUser.client
            .from("profiles")
            .select("id")
            .eq("id", adminUser.userId);
          expect(profiles).toHaveLength(1);
        },
        RPC_TIMEOUT,
      );

      it(
        "don't count as a manager until approved",
        async () => {
          const pendingManager = await fixtureUser("pending-manager", "manager", { pending: true });
          const { data: whilePending } = await pendingManager.client.rpc("has_role", {
            _user_id: pendingManager.userId,
            _role: "manager",
          });
          expect(whilePending).toBe(false);

          const { error: approveError } = await adminUser.client.rpc("approve_member", {
            _user_id: pendingManager.userId,
          });
          expect(approveError).toBeNull();

          const { data: onceApproved } = await pendingManager.client.rpc("has_role", {
            _user_id: pendingManager.userId,
            _role: "manager",
          });
          expect(onceApproved).toBe(true);
        },
        RPC_TIMEOUT,
      );

      // 20261011020000_hide_pending_profiles.sql
      it(
        "are hidden from members and managers, but not from admins",
        async () => {
          const pending = await fixtureUser("pending-hidden", "member", { pending: true });
          const visibleTo = async (viewer: { client: SupabaseClient<Database> }) => {
            const { data } = await viewer.client
              .from("profiles")
              .select("id")
              .eq("id", pending.userId);
            return (data ?? []).length;
          };
          // A fresh member: memberUser was promoted to manager by the set_member_role tests.
          const plainMember = await fixtureUser("plain-member", "member");
          expect(await visibleTo(plainMember)).toBe(0);
          expect(await visibleTo(managerUser)).toBe(0);
          expect(await visibleTo(adminUser)).toBe(1);
        },
        RPC_TIMEOUT,
      );
    });
  });
}
