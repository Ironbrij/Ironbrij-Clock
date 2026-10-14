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

    // 20261014000000_entry_tags_follow_project.sql: a manager moved an entry
    // to another project on Manage > Entries and Reports kept showing the old
    // project's tags, because tag_ids was only ever copied at insert time.
    // The steps below share state and run in order.
    describe("entry tags follow their project", () => {
      let tagMember: Awaited<ReturnType<typeof fixtureUser>>;
      const tagIds: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
      const projectIds: Record<"a" | "b", string> = { a: "", b: "" };
      let entryId: string;

      const sorted = (ids: string[] | null | undefined) => [...(ids ?? [])].sort();
      const entryTags = async (id: string) => {
        const { data } = await admin.from("time_entries").select("tag_ids").eq("id", id).single();
        return sorted(data?.tag_ids);
      };
      const editActivityCount = async () => {
        const { count } = await admin
          .from("activity_log")
          .select("id", { count: "exact", head: true })
          .eq("target_user_id", tagMember.userId)
          .eq("action", "time_entry_edited");
        return count ?? 0;
      };
      // Weeks in the past so nothing here collides with the submit/review
      // tests' current-week timesheet.
      const weeksAgo = (weeks: number) => {
        const { entryStart, entryEnd, weekStartDate } = thisWeekWednesdayUtc();
        const shift = weeks * 7 * 86_400_000;
        const monday = new Date(new Date(`${weekStartDate}T00:00:00Z`).getTime() - shift);
        return {
          weekStartDate: monday.toISOString().slice(0, 10),
          entryStart: new Date(entryStart.getTime() - shift),
          entryEnd: new Date(entryEnd.getTime() - shift),
        };
      };

      beforeAll(async () => {
        tagMember = await fixtureUser("tag-member", "member");
        const { error: teamError } = await admin
          .from("team_members")
          .insert({ user_id: tagMember.userId, team_id: teamId });
        if (teamError) throw new Error(`team_members insert failed: ${teamError.message}`);

        for (const key of ["a", "b", "c"] as const) {
          const { data, error } = await admin
            .from("tags")
            .insert({ name: `Tag ${key} ${suffix}`, color: "#888888" })
            .select("id")
            .single();
          if (error || !data) throw new Error(`tag insert failed: ${error?.message}`);
          tagIds[key] = data.id;
        }
        for (const key of ["a", "b"] as const) {
          const { data, error } = await admin
            .from("projects")
            .insert({ name: `Tag project ${key} ${suffix}` })
            .select("id")
            .single();
          if (error || !data) throw new Error(`project insert failed: ${error?.message}`);
          projectIds[key] = data.id;
        }
        const { error: linkError } = await admin.from("project_tags").insert([
          { project_id: projectIds.a, tag_id: tagIds.a },
          { project_id: projectIds.a, tag_id: tagIds.c },
          { project_id: projectIds.b, tag_id: tagIds.b },
        ]);
        if (linkError) throw new Error(`project_tags insert failed: ${linkError.message}`);
      }, RPC_TIMEOUT);

      afterAll(async () => {
        await admin.from("time_entries").delete().eq("user_id", tagMember.userId);
        await admin.from("timesheets").delete().eq("user_id", tagMember.userId);
        await admin.from("projects").delete().in("id", Object.values(projectIds));
        await admin.from("tags").delete().in("id", Object.values(tagIds));
      }, RPC_TIMEOUT);

      it(
        "copies the project's tags onto a new entry, whatever tag_ids the caller sent",
        async () => {
          const { entryStart, entryEnd } = weeksAgo(3);
          const { data, error } = await admin
            .from("time_entries")
            .insert({
              user_id: tagMember.userId,
              project_id: projectIds.a,
              description: "Tag sync test",
              start_time: entryStart.toISOString(),
              end_time: entryEnd.toISOString(),
              tag_ids: [tagIds.b],
            })
            .select("id")
            .single();
          expect(error).toBeNull();
          entryId = data!.id;
          expect(await entryTags(entryId)).toEqual(sorted([tagIds.a, tagIds.c]));
        },
        RPC_TIMEOUT,
      );

      it(
        "gives an entry the new project's tags when its owner moves it",
        async () => {
          const { data, error } = await tagMember.client
            .from("time_entries")
            .update({ project_id: projectIds.b })
            .eq("id", entryId)
            .select("id");
          expect(error).toBeNull();
          expect(data).toHaveLength(1);
          expect(await entryTags(entryId)).toEqual([tagIds.b]);
        },
        RPC_TIMEOUT,
      );

      it(
        "does the same when a manager moves a team member's entry",
        async () => {
          const { data, error } = await managerUser.client
            .from("time_entries")
            .update({ project_id: projectIds.a })
            .eq("id", entryId)
            .select("id");
          expect(error).toBeNull();
          expect(data).toHaveLength(1);
          expect(await entryTags(entryId)).toEqual(sorted([tagIds.a, tagIds.c]));
        },
        RPC_TIMEOUT,
      );

      it(
        "leaves tags alone on an edit that doesn't change the project",
        async () => {
          await admin.from("project_tags").insert({ project_id: projectIds.a, tag_id: tagIds.b });
          // The entry dialog always resends project_id, so send it unchanged here too.
          const { error } = await tagMember.client
            .from("time_entries")
            .update({ project_id: projectIds.a, description: "Edited description" })
            .eq("id", entryId);
          expect(error).toBeNull();
          expect(await entryTags(entryId)).toEqual(sorted([tagIds.a, tagIds.c]));
        },
        RPC_TIMEOUT,
      );

      it(
        "retag_project_entries updates past entries, including an approved week, with no side effects",
        async () => {
          const approvedWeek = weeksAgo(2);
          const { data: inserted, error: insertError } = await admin
            .from("time_entries")
            .insert({
              user_id: tagMember.userId,
              project_id: projectIds.a,
              description: "Approved-week entry",
              start_time: approvedWeek.entryStart.toISOString(),
              end_time: approvedWeek.entryEnd.toISOString(),
            })
            .select("id, entry_date")
            .single();
          expect(insertError).toBeNull();
          const { data: sheet, error: sheetError } = await admin
            .from("timesheets")
            .insert({
              user_id: tagMember.userId,
              week_start: approvedWeek.weekStartDate,
              status: "approved",
            })
            .select("id")
            .single();
          expect(sheetError).toBeNull();

          // Project A is now {a, b}: both entries are stale ({a, c} and {a, b, c}).
          await admin
            .from("project_tags")
            .delete()
            .eq("project_id", projectIds.a)
            .eq("tag_id", tagIds.c);
          // A recomputed entry_date would land on a different day in Honolulu.
          await admin
            .from("profiles")
            .update({ timezone: "Pacific/Honolulu" })
            .eq("id", tagMember.userId);
          const activityBefore = await editActivityCount();

          const { data: count, error } = await managerUser.client.rpc("retag_project_entries", {
            _project_id: projectIds.a,
          });
          expect(error).toBeNull();
          expect(count).toBe(2);

          const expected = sorted([tagIds.a, tagIds.b]);
          expect(await entryTags(entryId)).toEqual(expected);
          expect(await entryTags(inserted!.id)).toEqual(expected);

          const { data: after } = await admin
            .from("time_entries")
            .select("entry_date")
            .eq("id", inserted!.id)
            .single();
          expect(after?.entry_date).toBe(inserted!.entry_date);
          const { data: sheetAfter } = await admin
            .from("timesheets")
            .select("entries_modified_at")
            .eq("id", sheet!.id)
            .single();
          expect(sheetAfter?.entries_modified_at).toBeNull();
          expect(await editActivityCount()).toBe(activityBefore);

          // Nothing left to change on a second run.
          const { data: secondCount } = await managerUser.client.rpc("retag_project_entries", {
            _project_id: projectIds.a,
          });
          expect(secondCount).toBe(0);
        },
        RPC_TIMEOUT,
      );

      it(
        "rejects retag_project_entries from a plain member",
        async () => {
          const { error } = await tagMember.client.rpc("retag_project_entries", {
            _project_id: projectIds.a,
          });
          expect(error?.message).toMatch(/not authorized/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "delete_tag strips the tag without logging an edit per entry",
        async () => {
          const activityBefore = await editActivityCount();
          const { error } = await managerUser.client.rpc("delete_tag", { _tag_id: tagIds.b });
          expect(error).toBeNull();
          expect(await entryTags(entryId)).toEqual([tagIds.a]);
          expect(await editActivityCount()).toBe(activityBefore);
        },
        RPC_TIMEOUT,
      );
    });

    // 20261014010000_placement_employment_type.sql: Billing → Placements'
    // full-time / part-time sections read this column.
    describe("va_placements employment_type", () => {
      let clientId: string;
      let placedVaId: string;
      let placementId: string;

      beforeAll(async () => {
        const { data: client, error: clientError } = await admin
          .from("clients")
          .insert({ name: `Placement client ${suffix}` })
          .select("id")
          .single();
        if (clientError || !client)
          throw new Error(`client insert failed: ${clientError?.message}`);
        clientId = client.id;
        const { data: va, error: vaError } = await admin
          .from("placed_vas")
          .insert({ full_name: `Placed VA ${suffix}` })
          .select("id")
          .single();
        if (vaError || !va) throw new Error(`placed_vas insert failed: ${vaError?.message}`);
        placedVaId = va.id;
        const { data: placement, error: placementError } = await admin
          .from("va_placements")
          .insert({ placed_va_id: placedVaId, client_id: clientId, started_on: "2026-09-01" })
          .select("id, employment_type")
          .single();
        if (placementError || !placement)
          throw new Error(`va_placements insert failed: ${placementError?.message}`);
        placementId = placement.id;
        expect(placement.employment_type).toBe("full_time");
      }, RPC_TIMEOUT);

      afterAll(async () => {
        await admin.from("va_placements").delete().eq("id", placementId);
        await admin.from("placed_vas").delete().eq("id", placedVaId);
        await admin.from("clients").delete().eq("id", clientId);
      }, RPC_TIMEOUT);

      it(
        "lets a manager mark a placement part-time",
        async () => {
          const { data, error } = await managerUser.client
            .from("va_placements")
            .update({ employment_type: "part_time" })
            .eq("id", placementId)
            .select("employment_type");
          expect(error).toBeNull();
          expect(data).toEqual([{ employment_type: "part_time" }]);
        },
        RPC_TIMEOUT,
      );

      it(
        "rejects anything other than full_time or part_time",
        async () => {
          const { error } = await managerUser.client
            .from("va_placements")
            .update({ employment_type: "casual" })
            .eq("id", placementId);
          expect(error?.code).toBe("23514");
        },
        RPC_TIMEOUT,
      );
    });
  });
}
