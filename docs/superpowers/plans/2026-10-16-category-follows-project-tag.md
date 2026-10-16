# Service Category Follows the Project's Tag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An entry's casual service category, which decides the Paid Casual increment, comes only from its project's tag. Nobody picks it per entry any more.

**Architecture:** `tags` gets a `service_category` column linking a tag to a billing category. `time_entries.service_category` stays, so every report, SQL function and constraint keeps reading it, but it is now derived. The existing `sync_entry_tags_from_project()` trigger sets it from the project's category tag. It is re-synced when a tag's link changes, on retag and on tag delete. The entry form loses its dropdown, and the Detailed report gains a Category column.

**Tech Stack:** Supabase Postgres (plpgsql triggers, `SECURITY DEFINER` functions), TanStack Start + React, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-category-follows-project-tag-design.md`

## Global Constraints

- Migrations must be safe to re-run: `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`, and backfills guarded so a second run changes nothing. They are sometimes applied by hand in the SQL editor before the merge.
- Migrations apply automatically on merge to `main`. The app may deploy a moment before the migration, so client code must not hard-fail if `tags.service_category` is missing yet. Read tags with `select("*")`.
- Every new function: `REVOKE ALL ... FROM PUBLIC, anon`, then `GRANT EXECUTE ... TO authenticated` only if the browser calls it. Internal helpers and trigger functions are revoked from `authenticated` too.
- Every business rule is enforced twice: in the `workspace/use-*` hook or UI (friendly message) **and** in Postgres (backstop). See CLAUDE.md, "Authorization model".
- `src/integrations/supabase/types.ts` is hand-maintained and CI checks it against the migrations. Update it in the same task as the migration.
- Docker is not available on this machine. `rpc.integration.test.ts` skips locally and only runs in CI (`.github/workflows/ci.yml`). If CI's types check fails, commit the `supabase-types` artifact it uploads.
- Only admins may set or change a tag's category. Managers keep every other tag power they have today.
- Category tags are linked by case-insensitive name: `Paid Casual Service (Implement)` → `paid_casual`, `VIP Client (Clarify)` → `vip_client`, `Promotional` → `promotional`, `Ironbrij` → `ironbrij`.
- Don't rewrite pushed git history (see AGENTS.md). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Swapping a project's category tag in one save** (remove VIP Client, add Paid Casual). `writeProjectLinks` deletes all of the project's links, then inserts the new set. The conflict trigger must not reject that, and the entries must follow when retag is ticked. *Pinned in Task 1, test "retag moves a project to a different category…".*
2. **Moving an entry already marked "VA paid" to a project with no category.** The paid-date constraint rejects it, and the person must see a plain message, not `violates check constraint`. *Pinned in Task 1 (DB rejects with 23514) and Task 4 (message mapping).*
3. **Linking a category to a tag that no project uses.** An empty project list must re-sync nothing. A `NULL` list means "all entries", so the two must never be confused. *Pinned in Task 1, test "linking a tag no project uses changes no entries".*
4. **A manager renaming or recolouring a category tag.** The form sends the unchanged category back, and that must not trip the admin-only guard. *Pinned in Task 1, test "a manager can rename a category tag…".*
5. **The app deploying before the migration.** The tags query must keep working without the column. *Handled in Task 2 by `select("*")` and `?? null`. Not testable in CI, because CI always has the migration.*

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20261016000000_category_follows_project_tag.sql` (new) | Column, helpers, triggers, guards, backfill | 1 |
| `src/lib/workspace/rpc.integration.test.ts` | New `describe` block for the DB rules | 1 |
| `src/integrations/supabase/types.ts` | `tags.service_category`, two new functions | 1 |
| `src/lib/service-category.ts` (new) | Pure helpers: which category a set of tags implies, which picked tags conflict | 2 |
| `src/lib/service-category.test.ts` (new) | Unit tests for the above | 2 |
| `src/lib/workspace/types.ts` | `WorkspaceTag.serviceCategory` | 2 |
| `src/lib/workspace/use-tags.ts` | Read/write `service_category`, admin check | 2 |
| `src/lib/workspace-store.tsx` | Pass `isAdmin` to `useTagsData`, new `createTag`/`updateTag` signatures, drop `serviceCategory` from entry inputs | 2, 4 |
| `src/routes/projects.tsx` | Tag form category select (admin only), category chip on tag cards, project form conflict block | 3 |
| `src/components/entry-form-dialog.tsx` | Remove dropdown and pre-fill, add read-only line | 4 |
| `src/lib/workspace/use-time-entries.ts` | Stop sending `service_category`, map 23514 | 4 |
| `src/components/reports/detailed-report-view.tsx`, `src/routes/reports.tsx` | Category column and CSV column | 5 |
| `docs/checks/2026-10-16-category-follows-tag-precheck.sql` (new) | Read-only production pre-merge check | 6 |

---

### Task 1: Database — tags carry the category, entries follow

**Files:**
- Create: `supabase/migrations/20261016000000_category_follows_project_tag.sql`
- Modify: `src/lib/workspace/rpc.integration.test.ts` (add a `describe` block after "entry tags follow their project", before "va_placements employment_type")
- Modify: `src/integrations/supabase/types.ts` (`tags` table, `Functions`)

**Interfaces:**
- Produces (SQL):
  - `tags.service_category public.casual_service_category NULL`
  - `public.project_service_category(_project_id uuid) RETURNS public.casual_service_category`. Callable by `authenticated`.
  - `public.resync_entry_service_categories(_project_ids uuid[] DEFAULT NULL) RETURNS SETOF uuid`. Internal only. `NULL` means every entry; `'{}'` means none.
  - Error texts the UI relies on: `'A project can only have one casual service tag'` (prefix), `'Only admins can change what a tag means for billing.'` (SQLSTATE 42501). A paid entry losing its category fails the existing CHECK with SQLSTATE 23514.

- [ ] **Step 1: Write the failing integration tests**

Add this block inside the top-level `describe`, directly after the closing `});` of `describe("entry tags follow their project", …)`:

```ts
    // 20261016000000_category_follows_project_tag.sql: an entry's casual
    // service category comes only from its project's category tag.
    describe("service category follows the project's tag", () => {
      let catMember: Awaited<ReturnType<typeof fixtureUser>>;
      const tagIds: Record<"pc" | "vip" | "plain" | "spare", string> = {
        pc: "",
        vip: "",
        plain: "",
        spare: "",
      };
      const projectIds: Record<"pc" | "vip" | "plain", string> = { pc: "", vip: "", plain: "" };
      let timerId: string;

      const categoryOf = async (id: string) => {
        const { data } = await admin
          .from("time_entries")
          .select("service_category")
          .eq("id", id)
          .single();
        return data?.service_category ?? null;
      };
      const editActivityCount = async () => {
        const { count } = await admin
          .from("activity_log")
          .select("id", { count: "exact", head: true })
          .eq("target_user_id", catMember.userId)
          .eq("action", "time_entry_edited");
        return count ?? 0;
      };
      const weeksAgo = (weeks: number) => {
        const { entryStart, entryEnd } = thisWeekWednesdayUtc();
        const shift = weeks * 7 * 86_400_000;
        return {
          entryStart: new Date(entryStart.getTime() - shift),
          entryEnd: new Date(entryEnd.getTime() - shift),
        };
      };
      const insertEntry = async (projectId: string, weeks: number) => {
        const { entryStart, entryEnd } = weeksAgo(weeks);
        const { data, error } = await admin
          .from("time_entries")
          .insert({
            user_id: catMember.userId,
            project_id: projectId,
            description: "Category test",
            start_time: entryStart.toISOString(),
            end_time: entryEnd.toISOString(),
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`entry insert failed: ${error?.message}`);
        return data.id;
      };

      beforeAll(async () => {
        catMember = await fixtureUser("cat-member", "member");
        const { error: teamError } = await admin
          .from("team_members")
          .insert({ user_id: catMember.userId, team_id: teamId });
        if (teamError) throw new Error(`team_members insert failed: ${teamError.message}`);

        const tagRows = [
          { key: "pc", category: "paid_casual" },
          { key: "vip", category: "vip_client" },
          { key: "plain", category: null },
          { key: "spare", category: null },
        ] as const;
        for (const { key, category } of tagRows) {
          const { data, error } = await admin
            .from("tags")
            .insert({ name: `Cat tag ${key} ${suffix}`, color: "#888888", service_category: category })
            .select("id")
            .single();
          if (error || !data) throw new Error(`tag insert failed: ${error?.message}`);
          tagIds[key] = data.id;
        }
        for (const key of ["pc", "vip", "plain"] as const) {
          const { data, error } = await admin
            .from("projects")
            .insert({ name: `Cat project ${key} ${suffix}` })
            .select("id")
            .single();
          if (error || !data) throw new Error(`project insert failed: ${error?.message}`);
          projectIds[key] = data.id;
        }
        const { error: linkError } = await admin.from("project_tags").insert([
          { project_id: projectIds.pc, tag_id: tagIds.pc },
          { project_id: projectIds.vip, tag_id: tagIds.vip },
          { project_id: projectIds.plain, tag_id: tagIds.plain },
        ]);
        if (linkError) throw new Error(`project_tags insert failed: ${linkError.message}`);
      }, RPC_TIMEOUT);

      afterAll(async () => {
        await admin.from("time_entries").delete().eq("user_id", catMember.userId);
        await admin.from("projects").delete().in("id", Object.values(projectIds));
        await admin.from("tags").delete().in("id", Object.values(tagIds));
      }, RPC_TIMEOUT);

      it(
        "gives a timer started on a Paid Casual project that category, whatever the caller sent",
        async () => {
          const { data, error } = await catMember.client
            .from("time_entries")
            .insert({
              user_id: catMember.userId,
              project_id: projectIds.pc,
              description: "Timer",
              start_time: new Date(Date.now() - 60_000).toISOString(),
              service_category: "vip_client",
            })
            .select("id")
            .single();
          expect(error).toBeNull();
          timerId = data!.id;
          expect(await categoryOf(timerId)).toBe("paid_casual");
          // Stop it so it doesn't block anything else this user does.
          await admin
            .from("time_entries")
            .update({ end_time: new Date().toISOString() })
            .eq("id", timerId);
        },
        RPC_TIMEOUT,
      );

      it(
        "replaces a category the owner writes directly with the project's",
        async () => {
          const { error } = await catMember.client
            .from("time_entries")
            .update({ service_category: "vip_client" })
            .eq("id", timerId);
          expect(error).toBeNull();
          expect(await categoryOf(timerId)).toBe("paid_casual");
        },
        RPC_TIMEOUT,
      );

      it(
        "follows the entry when it moves project, including to one with no category",
        async () => {
          await catMember.client
            .from("time_entries")
            .update({ project_id: projectIds.vip })
            .eq("id", timerId);
          expect(await categoryOf(timerId)).toBe("vip_client");
          await catMember.client
            .from("time_entries")
            .update({ project_id: projectIds.plain })
            .eq("id", timerId);
          expect(await categoryOf(timerId)).toBeNull();
        },
        RPC_TIMEOUT,
      );

      it(
        "rejects a second category tag on a project",
        async () => {
          const { error } = await managerUser.client
            .from("project_tags")
            .insert({ project_id: projectIds.pc, tag_id: tagIds.vip });
          expect(error?.message).toMatch(/only have one casual service tag/i);
        },
        RPC_TIMEOUT,
      );

      it(
        "stops a manager changing a tag's category",
        async () => {
          const { error } = await managerUser.client
            .from("tags")
            .update({ service_category: "promotional" })
            .eq("id", tagIds.plain);
          expect(error?.code).toBe("42501");
        },
        RPC_TIMEOUT,
      );

      it(
        "a manager can rename a category tag, sending its category back unchanged",
        async () => {
          const { data, error } = await managerUser.client
            .from("tags")
            .update({ name: `Cat tag pc renamed ${suffix}`, service_category: "paid_casual" })
            .eq("id", tagIds.pc)
            .select("id");
          expect(error).toBeNull();
          expect(data).toHaveLength(1);
        },
        RPC_TIMEOUT,
      );

      it(
        "linking a tag no project uses changes no entries",
        async () => {
          const before = await categoryOf(timerId);
          const { error } = await adminUser.client
            .from("tags")
            .update({ service_category: "promotional" })
            .eq("id", tagIds.spare);
          expect(error).toBeNull();
          expect(await categoryOf(timerId)).toBe(before);
          await admin.from("tags").update({ service_category: null }).eq("id", tagIds.spare);
        },
        RPC_TIMEOUT,
      );

      it(
        "rejects linking a tag that would give a project two category tags",
        async () => {
          await admin
            .from("project_tags")
            .insert({ project_id: projectIds.pc, tag_id: tagIds.plain });
          const { error } = await adminUser.client
            .from("tags")
            .update({ service_category: "promotional" })
            .eq("id", tagIds.plain);
          expect(error?.message).toMatch(/only have one casual service tag/i);
          await admin
            .from("project_tags")
            .delete()
            .eq("project_id", projectIds.pc)
            .eq("tag_id", tagIds.plain);
        },
        RPC_TIMEOUT,
      );

      it(
        "an admin linking a tag re-syncs past entries with no side effects",
        async () => {
          const entryId = await insertEntry(projectIds.plain, 4);
          const { data: before } = await admin
            .from("time_entries")
            .select("entry_date")
            .eq("id", entryId)
            .single();
          await admin
            .from("profiles")
            .update({ timezone: "Pacific/Honolulu" })
            .eq("id", catMember.userId);
          const activityBefore = await editActivityCount();

          const { error } = await adminUser.client
            .from("tags")
            .update({ service_category: "promotional" })
            .eq("id", tagIds.plain);
          expect(error).toBeNull();
          expect(await categoryOf(entryId)).toBe("promotional");
          expect(await categoryOf(timerId)).toBe("promotional");

          const { data: after } = await admin
            .from("time_entries")
            .select("entry_date")
            .eq("id", entryId)
            .single();
          expect(after?.entry_date).toBe(before?.entry_date);
          expect(await editActivityCount()).toBe(activityBefore);

          await admin
            .from("profiles")
            .update({ timezone: "Australia/Sydney" })
            .eq("id", catMember.userId);
          await admin.from("tags").update({ service_category: null }).eq("id", tagIds.plain);
          expect(await categoryOf(entryId)).toBeNull();
        },
        RPC_TIMEOUT,
      );

      it(
        "retag moves a project to a different category, counting each entry once",
        async () => {
          const entryId = await insertEntry(projectIds.vip, 5);
          // The project form's save: delete every link, insert the new set.
          const { error: delError } = await managerUser.client
            .from("project_tags")
            .delete()
            .eq("project_id", projectIds.vip);
          expect(delError).toBeNull();
          const { error: insError } = await managerUser.client
            .from("project_tags")
            .insert({ project_id: projectIds.vip, tag_id: tagIds.pc });
          expect(insError).toBeNull();

          const { data: count, error } = await managerUser.client.rpc("retag_project_entries", {
            _project_id: projectIds.vip,
          });
          expect(error).toBeNull();
          // Tags and category both changed on this one entry: counted once.
          expect(count).toBe(1);
          expect(await categoryOf(entryId)).toBe("paid_casual");
        },
        RPC_TIMEOUT,
      );

      it(
        "keeps a paid entry's category, and won't move it to an uncategorised project",
        async () => {
          // Three weeks back: the same age the tag-sync tests already show an
          // owner can still edit.
          const paidId = await insertEntry(projectIds.pc, 3);
          await admin.from("time_entries").update({ va_paid_at: "2026-10-01" }).eq("id", paidId);
          const unpaidId = await insertEntry(projectIds.pc, 3);

          const { error: moveError } = await catMember.client
            .from("time_entries")
            .update({ project_id: projectIds.plain })
            .eq("id", paidId);
          expect(moveError?.code).toBe("23514");

          // Unlinking the tag: the unpaid entry clears, the paid one is kept.
          await admin.from("tags").update({ service_category: null }).eq("id", tagIds.pc);
          expect(await categoryOf(unpaidId)).toBeNull();
          expect(await categoryOf(paidId)).toBe("paid_casual");
          await admin
            .from("tags")
            .update({ service_category: "paid_casual" })
            .eq("id", tagIds.pc);
          expect(await categoryOf(unpaidId)).toBe("paid_casual");
        },
        RPC_TIMEOUT,
      );

      it(
        "delete_tag clears the category from that tag's entries without logging edits",
        async () => {
          // Nothing carries the vip tag any more (the retag test swapped it
          // off its project), so put it on the plain project and give that
          // project's entries its category before deleting it.
          const entryId = await insertEntry(projectIds.plain, 3);
          await admin
            .from("project_tags")
            .delete()
            .eq("project_id", projectIds.plain);
          await admin
            .from("project_tags")
            .insert({ project_id: projectIds.plain, tag_id: tagIds.vip });
          await admin.rpc("resync_entry_service_categories", { _project_ids: [projectIds.plain] });
          expect(await categoryOf(entryId)).toBe("vip_client");
          const activityBefore = await editActivityCount();

          const { error } = await managerUser.client.rpc("delete_tag", { _tag_id: tagIds.vip });
          expect(error).toBeNull();
          expect(await categoryOf(entryId)).toBeNull();
          expect(await editActivityCount()).toBe(activityBefore);
        },
        RPC_TIMEOUT,
      );
    });
```

`admin.rpc("resync_entry_service_categories", …)` is called with the service-role client. The function is revoked from `authenticated`, but `service_role` can still call it, and it exists in the typed `Functions` once Step 4 is done.

- [ ] **Step 2: Confirm the tests fail to compile against the current schema**

Run: `npm run typecheck`
Expected: FAIL, with errors that `service_category` is not in the `tags` insert/update types and `resync_entry_service_categories` is not a known function. These DB tests can't run locally (no Docker). They run in CI.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261016000000_category_follows_project_tag.sql`:

```sql
-- A time entry's casual service category follows its project's tag
-- (decided 2026-10-16). Spec:
-- docs/superpowers/specs/2026-10-16-category-follows-project-tag-design.md
--
-- time_entries.service_category used to be a per-entry dropdown, labelled
-- optional, that decides whether Paid Casual's increment applies. Timer
-- entries never got one and the form pre-filled it from the last entry for
-- the same client, so the 1-16 October export had 12 Paid Casual entries
-- billed without the increment and 30 internal/VIP entries billed with it.
--
-- A project is only ever one kind of work, so the project's tag is now the
-- only label: a tag can be linked to a category (admins only), a project can
-- carry at most one such tag, and every entry's category is derived from it.
-- The entry column stays, so reports, casual_report_for_client() and
-- time_entries_va_paid_requires_category keep reading it unchanged.

-- 1. Which billing category a tag stands for. NULL for ordinary tags.
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS service_category public.casual_service_category;

-- 2. A project's category: its category tag's, or NULL. At most one such tag
--    exists per project (section 5); ORDER BY just makes it deterministic.
CREATE OR REPLACE FUNCTION public.project_service_category(_project_id uuid)
RETURNS public.casual_service_category
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.service_category
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  WHERE pt.project_id = _project_id
    AND t.service_category IS NOT NULL
  ORDER BY t.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.project_service_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_service_category(uuid) TO authenticated;

-- 3. Bring entries in line with their project's category. NULL means every
--    entry; an empty array means none. Callers building the list from a
--    query must use ARRAY(...) (empty when nothing matches), never
--    array_agg (NULL when nothing matches, which would mean everything).
--
--    An entry already marked VA-paid is never left without a category:
--    time_entries_va_paid_requires_category forbids it, and a paid record
--    shouldn't be silently rewritten. It keeps its category instead.
--
--    Returns the ids it changed, so retag_project_entries can count an
--    entry whose tags and category both changed only once.
CREATE OR REPLACE FUNCTION public.resync_entry_service_categories(_project_ids uuid[] DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH target AS (
    SELECT te.id, public.project_service_category(te.project_id) AS category
    FROM public.time_entries te
    WHERE _project_ids IS NULL OR te.project_id = ANY (_project_ids)
  ),
  updated AS (
    UPDATE public.time_entries te
    SET service_category = target.category
    FROM target
    WHERE te.id = target.id
      AND te.service_category IS DISTINCT FROM target.category
      AND NOT (te.va_paid_at IS NOT NULL AND target.category IS NULL)
    RETURNING te.id
  )
  SELECT updated.id FROM updated;
END;
$$;
REVOKE ALL ON FUNCTION public.resync_entry_service_categories(uuid[]) FROM PUBLIC, anon, authenticated;
-- Explicit, so the integration tests' service-role client can call it
-- whatever the project's default function privileges are.
GRANT EXECUTE ON FUNCTION public.resync_entry_service_categories(uuid[]) TO service_role;

-- 4. The four side-effect guards from 20261014000000 skip a write that only
--    changed tag_ids. They now also skip one that only changed
--    service_category, so the bulk re-syncs below don't move entry_date,
--    log an edit per entry or flag approved weeks. Bodies are otherwise
--    copied unchanged from that migration.
CREATE OR REPLACE FUNCTION public.compute_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
    RETURN NEW;
  END IF;
  IF NEW.end_time IS NULL THEN
    NEW.duration_seconds := NULL;
    NEW.duration_minutes := NULL;
  ELSE
    NEW.duration_seconds := GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)))
    )::integer;
    NEW.duration_minutes := GREATEST(
      1,
      ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60)
    )::integer;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_time_entry_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _tz text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
    RETURN NEW;
  END IF;
  SELECT timezone INTO _tz FROM public.profiles WHERE id = NEW.user_id;
  NEW.entry_date := (NEW.start_time AT TIME ZONE COALESCE(_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_time_entry_edit_by_other()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
     = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
      RETURN NEW;
    END IF;
    IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_edited',
        NEW.user_id,
        jsonb_build_object('entry_id', NEW.id, 'entry_date', NEW.entry_date)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
      INSERT INTO public.activity_log (actor_id, action, target_user_id, metadata)
      VALUES (
        auth.uid(),
        'time_entry_deleted',
        OLD.user_id,
        jsonb_build_object(
          'entry_id', OLD.id,
          'entry_date', OLD.entry_date,
          'description', OLD.description
        )
      );
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.flag_approved_week_modified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['tag_ids', 'service_category'])
       = (to_jsonb(OLD) - ARRAY['tag_ids', 'service_category']) THEN
    RETURN NEW;
  END IF;
  -- Covers both directions of a date-changing UPDATE (moving an entry out
  -- of, or into, an approved week) as well as plain INSERT/DELETE.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = OLD.user_id
      AND status = 'approved'
      AND OLD.entry_date >= week_start
      AND OLD.entry_date < week_start + 7;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.timesheets
    SET entries_modified_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'approved'
      AND NEW.entry_date >= week_start
      AND NEW.entry_date < week_start + 7;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5. An entry's tags and category come from its project. Tags change only
--    when project_id does (an unticked retag keeps old tags on old entries,
--    as before). The category follows the same rule, and in addition any
--    write to the category on its own is replaced by the project's, so no
--    caller can set one directly. A paid entry moved to a project with no
--    category fails time_entries_va_paid_requires_category (23514), which
--    the app turns into a plain message.
CREATE OR REPLACE FUNCTION public.sync_entry_tags_from_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id THEN
    IF NEW.service_category IS DISTINCT FROM OLD.service_category THEN
      NEW.service_category := public.project_service_category(NEW.project_id);
    END IF;
    RETURN NEW;
  END IF;
  NEW.tag_ids := ARRAY(
    SELECT tag_id FROM public.project_tags
    WHERE project_id = NEW.project_id
    ORDER BY tag_id
  );
  NEW.service_category := public.project_service_category(NEW.project_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_entries_sync_tags_from_project ON public.time_entries;
CREATE TRIGGER time_entries_sync_tags_from_project
BEFORE INSERT OR UPDATE OF project_id, service_category ON public.time_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_entry_tags_from_project();

-- 6. One category tag per project. BEFORE ROW, so a multi-row insert (the
--    project form saves its whole tag set in one statement) sees the rows it
--    inserted before the current one and rejects the second category tag.
CREATE OR REPLACE FUNCTION public.guard_one_category_tag_per_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tags WHERE id = NEW.tag_id AND service_category IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  SELECT t.name INTO _existing
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  WHERE pt.project_id = NEW.project_id
    AND pt.tag_id <> NEW.tag_id
    AND pt.id IS DISTINCT FROM NEW.id
    AND t.service_category IS NOT NULL
  LIMIT 1;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'A project can only have one casual service tag, and this one already has "%".', _existing;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_one_category_tag_per_project() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_tags_one_category_tag ON public.project_tags;
CREATE TRIGGER project_tags_one_category_tag
BEFORE INSERT OR UPDATE ON public.project_tags
FOR EACH ROW EXECUTE FUNCTION public.guard_one_category_tag_per_project();

-- 7. Only admins set or change a tag's category; managers keep every other
--    tag power. RLS can't limit one column for one role, so this is a
--    trigger, like guard_profile_privileged_columns. Not SECURITY DEFINER:
--    current_user has to be the caller's role for the service-role and
--    migration bypass to work. Also refuses a link that would give some
--    project two category tags.
CREATE OR REPLACE FUNCTION public.guard_tag_service_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.service_category IS NOT DISTINCT FROM OLD.service_category THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.service_category IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change what a tag means for billing.'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.service_category IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_tags mine
    JOIN public.project_tags other
      ON other.project_id = mine.project_id AND other.tag_id <> mine.tag_id
    JOIN public.tags other_tag ON other_tag.id = other.tag_id
    WHERE mine.tag_id = NEW.id
      AND other_tag.service_category IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A project can only have one casual service tag, and a project with this tag already has another.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tag_service_category() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tags_guard_service_category ON public.tags;
CREATE TRIGGER tags_guard_service_category
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.guard_tag_service_category();

-- 8. Changing what a tag means re-syncs every entry on its projects, past
--    ones included: an admin changing the mapping is a deliberate billing
--    change. AFTER, so project_service_category() sees the new value.
CREATE OR REPLACE FUNCTION public.resync_entries_for_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM count(*) FROM public.resync_entry_service_categories(
    ARRAY(SELECT project_id FROM public.project_tags WHERE tag_id = NEW.id)
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.resync_entries_for_tag() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tags_resync_entry_categories ON public.tags;
CREATE TRIGGER tags_resync_entry_categories
AFTER UPDATE OF service_category ON public.tags
FOR EACH ROW
WHEN (OLD.service_category IS DISTINCT FROM NEW.service_category)
EXECUTE FUNCTION public.resync_entries_for_tag();

-- 9. "Also apply to entries already logged" now carries the category too.
--    The count is entries whose tags or category changed, each counted once.
CREATE OR REPLACE FUNCTION public.retag_project_entries(_project_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tags uuid[];
  _retagged uuid[];
  _count integer;
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to retag entries.';
  END IF;
  _tags := ARRAY(
    SELECT tag_id FROM public.project_tags
    WHERE project_id = _project_id
    ORDER BY tag_id
  );
  WITH changed AS (
    UPDATE public.time_entries
    SET tag_ids = _tags
    WHERE project_id = _project_id
      AND NOT (tag_ids @> _tags AND tag_ids <@ _tags)
    RETURNING id
  )
  SELECT ARRAY(SELECT id FROM changed) INTO _retagged;
  SELECT count(*) INTO _count
  FROM (
    SELECT unnest(_retagged)
    UNION
    SELECT public.resync_entry_service_categories(ARRAY[_project_id])
  ) AS touched;
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.retag_project_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retag_project_entries(uuid) TO authenticated;

-- 10. Deleting a tag clears the category it gave. The project list is read
--     before the delete, because project_tags cascades away with the tag.
CREATE OR REPLACE FUNCTION public.delete_tag(_tag_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _projects uuid[];
BEGIN
  IF NOT public.can_manage(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to delete tags.';
  END IF;

  _projects := ARRAY(SELECT project_id FROM public.project_tags WHERE tag_id = _tag_id);

  UPDATE public.time_entries
  SET tag_ids = array_remove(tag_ids, _tag_id)
  WHERE _tag_id = ANY(tag_ids);

  DELETE FROM public.tags WHERE id = _tag_id;

  PERFORM count(*) FROM public.resync_entry_service_categories(_projects);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tag(uuid) TO authenticated;

-- 11. One-off backfill. Link the four tags by name (only ones not linked
--     yet, so a re-run changes nothing), then bring every entry in line with
--     its project. Linking fires section 8 per tag; the final full pass also
--     clears categories on entries whose project has no category tag. If
--     some project already carries two of these tags, section 7 rejects the
--     link and the migration stops: run
--     docs/checks/2026-10-16-category-follows-tag-precheck.sql first.
UPDATE public.tags SET service_category = 'paid_casual'
WHERE lower(name) = lower('Paid Casual Service (Implement)') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'vip_client'
WHERE lower(name) = lower('VIP Client (Clarify)') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'promotional'
WHERE lower(name) = lower('Promotional') AND service_category IS NULL;
UPDATE public.tags SET service_category = 'ironbrij'
WHERE lower(name) = lower('Ironbrij') AND service_category IS NULL;

DO $$
DECLARE
  _changed integer;
  _kept integer;
BEGIN
  SELECT count(*) INTO _changed FROM public.resync_entry_service_categories(NULL);
  SELECT count(*) INTO _kept
  FROM public.time_entries te
  WHERE te.va_paid_at IS NOT NULL
    AND te.service_category IS NOT NULL
    AND public.project_service_category(te.project_id) IS NULL;
  RAISE NOTICE 'Category backfill: % entries changed; % paid entries kept a category their project no longer has.', _changed, _kept;
END;
$$;
```

- [ ] **Step 4: Update `src/integrations/supabase/types.ts`**

In the `tags` table block, add `service_category` to `Row`, `Insert` and `Update`, in alphabetical position after `name`:

```ts
      tags: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          name: string;
          service_category: Database["public"]["Enums"]["casual_service_category"] | null;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          service_category?: Database["public"]["Enums"]["casual_service_category"] | null;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          service_category?: Database["public"]["Enums"]["casual_service_category"] | null;
        };
        Relationships: [];
      };
```

In `Functions`, add these in alphabetical order. `project_service_category` goes after `project_hours_range: { … };`. `resync_entry_service_categories` goes directly before `retag_project_entries`.

```ts
      project_service_category: {
        Args: { _project_id: string };
        Returns: Database["public"]["Enums"]["casual_service_category"];
      };
```

```ts
      resync_entry_service_categories: {
        Args: { _project_ids?: string[] };
        Returns: string[];
      };
```

Run: `npx prettier --write src/integrations/supabase/types.ts`

- [ ] **Step 5: Verify what can be verified locally**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test`
Expected: PASS. The integration file shows as skipped; every unit test passes.

Run: `npm run lint`
Expected: PASS.

The SQL itself is proven by CI's integration run (Task 7). If CI's types check fails, replace `types.ts` with the `supabase-types` artifact and commit it.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261016000000_category_follows_project_tag.sql src/lib/workspace/rpc.integration.test.ts src/integrations/supabase/types.ts
git commit -m "Entries take their casual service category from the project's tag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tags carry the category in the app

**Files:**
- Create: `src/lib/service-category.ts`
- Create: `src/lib/service-category.test.ts`
- Modify: `src/lib/workspace/types.ts:77`
- Modify: `src/lib/workspace/use-tags.ts`
- Modify: `src/lib/workspace-store.tsx:131-132` (context type), `:451` (hook call)

**Interfaces:**
- Consumes: `tags.service_category` (Task 1).
- Produces:
  - `WorkspaceTag = { id: string; name: string; color: string; entryCount: number; serviceCategory: CasualServiceCategory | null }`
  - `categoryTagsAmong<T extends { id: string; serviceCategory: CasualServiceCategory | null }>(tagIds: readonly string[], tags: readonly T[]): T[]`
  - `serviceCategoryForTags(tagIds: readonly string[], tags: readonly { id: string; serviceCategory: CasualServiceCategory | null }[]): CasualServiceCategory | null`
  - `createTag(name: string, color: string, serviceCategory?: CasualServiceCategory | null): Promise<void>`. Omitted means no category.
  - `updateTag(id: string, name: string, color: string, serviceCategory?: CasualServiceCategory | null): Promise<void>`. **Omitted means leave the category unchanged**, so an older three-argument caller can never clear it.
  - `useTagsData(enabled: boolean, isAdmin: boolean)`

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/service-category.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryTagsAmong, serviceCategoryForTags } from "./service-category";

const tags = [
  { id: "pc", serviceCategory: "paid_casual" as const },
  { id: "vip", serviceCategory: "vip_client" as const },
  { id: "client-a", serviceCategory: null },
];

describe("categoryTagsAmong", () => {
  it("returns only the picked tags that carry a category", () => {
    expect(categoryTagsAmong(["client-a", "pc"], tags).map((t) => t.id)).toEqual(["pc"]);
  });

  it("returns every category tag picked, so a caller can spot a conflict", () => {
    expect(categoryTagsAmong(["pc", "vip"], tags).map((t) => t.id)).toEqual(["pc", "vip"]);
  });

  it("ignores ids that aren't known tags", () => {
    expect(categoryTagsAmong(["deleted-tag"], tags)).toEqual([]);
  });
});

describe("serviceCategoryForTags", () => {
  it("is the category of the project's category tag", () => {
    expect(serviceCategoryForTags(["client-a", "vip"], tags)).toBe("vip_client");
  });

  it("is null for a project with no category tag", () => {
    expect(serviceCategoryForTags(["client-a"], tags)).toBeNull();
    expect(serviceCategoryForTags([], tags)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/lib/service-category.test.ts`
Expected: FAIL with "Failed to resolve import ./service-category".

- [ ] **Step 3: Implement the helpers**

Create `src/lib/service-category.ts`:

```ts
import type { CasualServiceCategory } from "@/lib/workspace/types";

type CategoryTag = { id: string; serviceCategory: CasualServiceCategory | null };

/**
 * The picked tags that carry a casual service category. A project may have
 * at most one (20261016000000_category_follows_project_tag.sql enforces it),
 * so more than one here is a conflict for the caller to report.
 */
export function categoryTagsAmong<T extends CategoryTag>(
  tagIds: readonly string[],
  tags: readonly T[],
): T[] {
  return tags.filter((t) => t.serviceCategory !== null && tagIds.includes(t.id));
}

/**
 * The category a project's tags give its entries — the same answer as the
 * database's project_service_category(). Null for ordinary client work.
 */
export function serviceCategoryForTags(
  tagIds: readonly string[],
  tags: readonly CategoryTag[],
): CasualServiceCategory | null {
  return categoryTagsAmong(tagIds, tags)[0]?.serviceCategory ?? null;
}
```

- [ ] **Step 4: Run them to make sure they pass**

Run: `npx vitest run src/lib/service-category.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add `serviceCategory` to `WorkspaceTag`**

In `src/lib/workspace/types.ts`, replace line 77:

```ts
export type WorkspaceTag = {
  id: string;
  name: string;
  color: string;
  entryCount: number;
  /** Set on a tag that stands for a casual service category; the project carrying it gives every entry that category. Null for ordinary tags. */
  serviceCategory: CasualServiceCategory | null;
};
```

`CasualServiceCategory` is declared earlier in the same file (line 31), so no import is needed.

- [ ] **Step 6: Read and write the category in `use-tags.ts`**

Change the signature and imports at the top:

```ts
import { throwIf } from "./utils";
import type { CasualServiceCategory, WorkspaceTag } from "./types";

/** Changing what a tag means for billing is admin-only — the DB's guard_tag_service_category() is the backstop. */
const ADMIN_ONLY_CATEGORY_MESSAGE = "Only admins can change what a tag means for billing.";

export function useTagsData(enabled: boolean, isAdmin: boolean) {
```

Replace the `tagsQ` query function. `select("*")` keeps this working if the app deploys a moment before the migration adds the column:

```ts
    queryFn: async () => {
      // "*" rather than a column list: if this deploys a moment before
      // 20261016000000 adds service_category, a named column would fail the
      // whole query and empty the Tags tab.
      const { data, error } = await supabase.from("tags").select("*").order("name");
      if (error) throw error;
      return data;
    },
```

In the `tags` memo, add the field:

```ts
    return (tagsQ.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      entryCount: usage.find((u) => u.tag_id === t.id)?.entry_count ?? 0,
      serviceCategory: t.service_category ?? null,
    }));
```

Replace `createTag` and `updateTag`:

```ts
  const createTag = useCallback(
    async (name: string, color: string, serviceCategory: CasualServiceCategory | null = null) => {
      if (serviceCategory !== null && !isAdmin) throw new Error(ADMIN_ONLY_CATEGORY_MESSAGE);
      const { error } = await supabase
        .from("tags")
        .insert({ name: name.trim(), color, service_category: serviceCategory });
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    [qc, isAdmin],
  );

  const updateTag = useCallback(
    async (
      id: string,
      name: string,
      color: string,
      // Omitted = leave it as it is. Never defaulted to null: that would let
      // a caller that doesn't know about categories wipe one out.
      serviceCategory?: CasualServiceCategory | null,
    ) => {
      const current = tagsQ.data?.find((t) => t.id === id);
      const categoryChanged =
        serviceCategory !== undefined && (current?.service_category ?? null) !== serviceCategory;
      if (categoryChanged && !isAdmin) throw new Error(ADMIN_ONLY_CATEGORY_MESSAGE);
      const { error } = await supabase
        .from("tags")
        .update({
          name: name.trim(),
          color,
          ...(serviceCategory !== undefined ? { service_category: serviceCategory } : {}),
        })
        .eq("id", id);
      throwIf(error, { "23505": "A tag with that name already exists." });
      qc.invalidateQueries({ queryKey: ["tags"] });
      // A changed category re-syncs entries on every project with this tag.
      if (categoryChanged) qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
    [qc, isAdmin, tagsQ.data],
  );
```

Also add `qc.invalidateQueries({ queryKey: ["time_entries"] });` to `deleteTag` after the existing invalidations, because deleting a category tag clears entries' categories.

- [ ] **Step 7: Update `workspace-store.tsx`**

Context type (lines 131-132):

```ts
  createTag: (
    name: string,
    color: string,
    serviceCategory?: CasualServiceCategory | null,
  ) => Promise<void>;
  /** Omit serviceCategory to leave the tag's category as it is. */
  updateTag: (
    id: string,
    name: string,
    color: string,
    serviceCategory?: CasualServiceCategory | null,
  ) => Promise<void>;
```

`CasualServiceCategory` is already imported at line 15. At line 451, pass `isAdmin`. It is destructured from the members hook a few lines above (line 392):

```ts
  const { tagsQ, tagUsageQ, tags, createTag, updateTag, deleteTag } = useTagsData(enabled, isAdmin);
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS. `projects.tsx` still calls `createTag`/`updateTag` with three arguments, which is valid: the category is optional and, on update, left unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/lib/service-category.ts src/lib/service-category.test.ts src/lib/workspace/types.ts src/lib/workspace/use-tags.ts src/lib/workspace-store.tsx
git commit -m "Tags carry their casual service category in the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Projects page — set a tag's category, block two on a project

**Files:**
- Modify: `src/routes/projects.tsx` (main component's `useWorkspace()` destructure ~line 130-144; `<TagsTab>` ~line 266; project form tag picker ~line 821-850 and save button ~line 930; `TagsTab` ~line 1681; tag card ~line 1739-1760; `TagFormDialog` ~line 1833-1925)

**Interfaces:**
- Consumes: `WorkspaceTag.serviceCategory`, `createTag(name, color, serviceCategory)`, `updateTag(id, name, color, serviceCategory)`, `isAdmin` from `useWorkspace()`, `categoryTagsAmong` (Task 2), `CASUAL_SERVICE_CATEGORY_LABELS` from `@/lib/workspace/types`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Pass `isAdmin` through to the Tags tab**

Add `isAdmin,` to the main component's `useWorkspace()` destructure (next to `createTag,`). Pass it to `<TagsTab … canManage={canManage} isAdmin={isAdmin} />`. Add `isAdmin: boolean;` to `TagsTab`'s props type and `isAdmin` to its parameter list. Pass `isAdmin={isAdmin}` on to `<TagFormDialog>`.

Update the `createTag`/`updateTag` prop types in both `TagsTab` and `TagFormDialog`:

```ts
  createTag: (
    name: string,
    color: string,
    serviceCategory?: CasualServiceCategory | null,
  ) => Promise<void>;
  updateTag: (
    id: string,
    name: string,
    color: string,
    serviceCategory?: CasualServiceCategory | null,
  ) => Promise<void>;
```

The dialog always passes its category explicitly (Step 2). For a manager, that's the tag's current value sent back unchanged, which the DB guard allows.

Import `CASUAL_SERVICE_CATEGORY_LABELS` and `type CasualServiceCategory` from `@/lib/workspace/types`, and `categoryTagsAmong` from `@/lib/service-category`. Check the existing import from `@/lib/workspace/types` and extend it rather than adding a second one.

- [ ] **Step 2: Add the category select to `TagFormDialog`**

State and reset:

```ts
  const [serviceCategory, setServiceCategory] = useState<CasualServiceCategory | null>(null);

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "");
      setColor(tag?.color ?? dotColors[0]);
      setServiceCategory(tag?.serviceCategory ?? null);
      setNameError(null);
    }
  }, [open, tag]);
```

In `submit`, pass it: `await updateTag(tag.id, trimmed, color, serviceCategory);` and `await createTag(trimmed, color, serviceCategory);`.

Add this block after the Colour group, inside `<div className="grid gap-4 py-2">`:

```tsx
          <div className="grid gap-2">
            <Label htmlFor="tag-service-category">Casual service category</Label>
            <Select
              value={serviceCategory ?? "none"}
              onValueChange={(v) =>
                setServiceCategory(v === "none" ? null : (v as CasualServiceCategory))
              }
              disabled={!isAdmin}
            >
              <SelectTrigger id="tag-service-category" aria-describedby="tag-service-category-help">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (ordinary tag)</SelectItem>
                {(Object.keys(CASUAL_SERVICE_CATEGORY_LABELS) as CasualServiceCategory[]).map(
                  (category) => (
                    <SelectItem key={category} value={category}>
                      {CASUAL_SERVICE_CATEGORY_LABELS[category]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <p id="tag-service-category-help" className="text-xs text-muted-foreground">
              {isAdmin
                ? "Every entry on a project with this tag is billed as this category, past entries included. A project can only have one of these tags."
                : "Only admins can change this, because it changes billing."}
            </p>
          </div>
```

If `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` aren't already imported in `projects.tsx`, import them from `@/components/ui/select`.

- [ ] **Step 3: Show the category on each tag card**

In `TagsTab`'s card, inside the `card-open` button after `<span className="truncate">{t.name}</span>`, add:

```tsx
                  {t.serviceCategory && (
                    <span className="shrink-0 text-xs font-normal opacity-80">
                      · {CASUAL_SERVICE_CATEGORY_LABELS[t.serviceCategory]}
                    </span>
                  )}
```

- [ ] **Step 4: Block a second category tag in the project form**

Below the existing `tagsChanged` constant in the project form component, add:

```ts
  // A project is one kind of work, so it can carry at most one casual
  // service tag. The DB's project_tags_one_category_tag trigger is the
  // backstop; this stops the save before writeProjectLinks has deleted the
  // old links.
  const pickedCategoryTags = categoryTagsAmong(tagIds, tags);
  const categoryConflict = pickedCategoryTags.length > 1;
```

Directly under the `<MultiSelectList … />` for tags, add:

```tsx
              {categoryConflict && (
                <p className="text-xs text-destructive" role="alert">
                  A project can only have one casual service tag. Untick all but one of{" "}
                  {pickedCategoryTags.map((t) => t.name).join(", ")}.
                </p>
              )}
```

Add `categoryConflict ||` to the save button's `disabled={…}` expression, before `saving`.

Change the retag hint so it says the category follows too. Replace the `{retagExisting ? … : …}` text with:

```tsx
                    {retagExisting
                      ? "Past entries get the new tags too, and their casual service category if that changed."
                      : "Unticked, only entries logged from now on get the new tags and category."}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS.

Then use the `run` skill to start the dev server and check, signed in as an admin:
- Projects → Tags → edit "Paid Casual Service (Implement)". The category select appears and is enabled.
- A project form with two category tags ticked shows the red message and a disabled Save.

As a manager, the select is disabled with the "Only admins…" text. If the app can't be launched here, say so in the report rather than claiming the UI was checked.

- [ ] **Step 6: Commit**

```bash
git add src/routes/projects.tsx
git commit -m "Projects: set a tag's casual service category; one per project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Entry form — no more category dropdown

**Files:**
- Modify: `src/components/entry-form-dialog.tsx` (lines ~126, 154-159, 174-177, 195-235, 258-261, 322-336, 532-572)
- Modify: `src/lib/workspace/use-time-entries.ts` (lines ~244-245, 270, 347, 367-368, 394, 407)
- Modify: `src/lib/workspace-store.tsx` (lines ~340-341, 351-352)

**Interfaces:**
- Consumes: `serviceCategoryForTags` (Task 2), `tags` from `useWorkspace()`, SQLSTATE 23514 from Task 1.
- Produces: `createEntry`/`updateEntry` no longer accept `serviceCategory`.

- [ ] **Step 1: Remove `serviceCategory` from the entry hooks**

In `use-time-entries.ts`:
- In `updateEntry`'s `patch` type, delete the `serviceCategory?: CasualServiceCategory | null;` line and its doc comment.
- Delete `if (patch.serviceCategory !== undefined) dbPatch.service_category = patch.serviceCategory;`.
- In `createEntry`'s `input` type, delete `serviceCategory?: CasualServiceCategory | null;` and its comment.
- Delete `const serviceCategory = input.serviceCategory ?? null;` and the `service_category: serviceCategory,` row field.
- If `CasualServiceCategory` is now unused in the file's import list (it's still used by the row type at line 41), leave the import alone; lint decides.

Add a message constant near the file's other message constants (search for `LOCKED_WEEK_MESSAGE`):

```ts
/** A paid entry can't lose its category (time_entries_va_paid_requires_category), so it can't move to a project without one. */
const PAID_ENTRY_MOVE_MESSAGE =
  "This entry is already marked as paid casual service, so it can't move to a project that isn't casual service. Ask an admin to clear the paid date first.";
```

Change `updateEntry`'s `throwIf(error, { "42501": POLICY_VIOLATION_MESSAGE });` to:

```ts
      throwIf(error, { "42501": POLICY_VIOLATION_MESSAGE, "23514": PAID_ENTRY_MOVE_MESSAGE });
```

In `workspace-store.tsx`, delete the `serviceCategory?: CasualServiceCategory | null;` lines (and their comments) from both the `createEntry` and the `updateEntry` context types. Keep the `CasualServiceCategory` import only if something else still uses it.

- [ ] **Step 2: Remove the dropdown and pre-fill from the form**

In `entry-form-dialog.tsx`:
- Line 126: add `tags` to the `useWorkspace()` destructure.
- Delete the `serviceCategory`/`serviceCategoryTouched` state (lines 154-159, with their comment).
- Delete `setServiceCategory(…)` and `setServiceCategoryTouched(…)` in the open/reset effect (lines 176-177).
- Delete the whole `lastCategoryByClient` memo and the effect after it (lines 195-235, comments included).
- In the `dirty` expression (lines 258-261), replace
  `? !isRunning && (billable !== entry.billable || serviceCategory !== entry.serviceCategory)`
  with `? !isRunning && billable !== entry.billable`,
  and `: billableTouched || serviceCategoryTouched);` with `: billableTouched);`.
- In submit: `isRunning ? { ...values, endTime: null } : { ...values, billable, serviceCategory }` becomes `isRunning ? { ...values, endTime: null } : { ...values, billable }`. Delete the `serviceCategory,` line from the `createEntry` call. Update the comment above (line 322) to say only `billable`.

After `const selectedProject = …` (line 240), add:

```ts
  // The category comes from the project's tag (20261016000000), never from
  // this form — shown so the person can see how the work will be billed.
  const projectCategory = selectedProject
    ? serviceCategoryForTags(selectedProject.tagIds, tags)
    : null;
```

Replace the whole `{/* M46: rare … */} {!isRunning && ( <div className="grid gap-2"> … </div> )}` block (lines 532-572) with:

```tsx
          {projectCategory && (
            <p className="text-xs text-muted-foreground">
              Casual service: {CASUAL_SERVICE_CATEGORY_LABELS[projectCategory]}, set by the
              project's tag.
            </p>
          )}
```

Import `serviceCategoryForTags` from `@/lib/service-category`. Change line 48 to `import { CASUAL_SERVICE_CATEGORY_LABELS } from "@/lib/workspace/types";`. Remove `Select*` imports only if lint reports them unused.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS.

Use the `run` skill to open the app. Start a timer and then edit an entry on a Paid Casual project. There is no category dropdown, and the line "Casual service: Paid Casual Service, set by the project's tag." shows. On an ordinary project, nothing shows. If the app can't be launched here, say so.

- [ ] **Step 4: Commit**

```bash
git add src/components/entry-form-dialog.tsx src/lib/workspace/use-time-entries.ts src/lib/workspace-store.tsx
git commit -m "Entry form: category comes from the project, no per-entry dropdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Detailed report — Category column

**Files:**
- Modify: `src/components/reports/detailed-report-view.tsx` (header ~line 48, cells ~line 86-103)
- Modify: `src/routes/reports.tsx` (Detailed CSV, ~lines 1695-1719)

**Interfaces:**
- Consumes: `DetailedReportRow.serviceCategory` (already on the row, spread from `DetailedEntry`), `CASUAL_SERVICE_CATEGORY_LABELS`.
- Produces: nothing.

- [ ] **Step 1: Add the column to the table**

In `detailed-report-view.tsx`, import `CASUAL_SERVICE_CATEGORY_LABELS` from `@/lib/workspace/types` (extend the existing type import line into a value-and-type import). After the Tags `<th>` (line 48), add:

```tsx
                <th className="px-5 py-3 text-left font-medium">Category</th>
```

After the Tags `<td>` block (the one ending around line 103, before the Task cell), add:

```tsx
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    {r.serviceCategory ? CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory] : "—"}
                  </td>
```

If the table has an empty-state or total row that uses a `colSpan`, increase it by one. Search the file for `colSpan`.

- [ ] **Step 2: Add the column to the Detailed CSV**

In `reports.tsx`'s `view === "detailed"` export, insert `"Category",` after `"Tags",` in the header row. In the row mapper, insert this after the tags line:

```ts
            r.serviceCategory ? CASUAL_SERVICE_CATEGORY_LABELS[r.serviceCategory] : "",
```

`CASUAL_SERVICE_CATEGORY_LABELS` is already imported in `reports.tsx`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/detailed-report-view.tsx src/routes/reports.tsx
git commit -m "Detailed report: show each entry's casual service category

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pre-merge production check

**Files:**
- Create: `docs/checks/2026-10-16-category-follows-tag-precheck.sql`

**Interfaces:** none. This is a read-only query the user runs in the Supabase SQL editor before merging.

- [ ] **Step 1: Write the query**

```sql
-- Read-only. Run in the Supabase SQL editor BEFORE merging the
-- category-follows-project-tag change, which applies automatically on merge.
-- Every block only SELECTs; nothing here changes data.

-- The four tags the migration links, by the same case-insensitive name match.
WITH mapping(tag_name, category) AS (
  VALUES
    ('paid casual service (implement)', 'paid_casual'::public.casual_service_category),
    ('vip client (clarify)', 'vip_client'),
    ('promotional', 'promotional'),
    ('ironbrij', 'ironbrij')
)

-- 1. Which of the four tags exist. A missing one means its projects get no
--    category until an admin links the right tag by hand.
SELECT m.tag_name AS expected_tag, t.id, t.name AS actual_name
FROM mapping m
LEFT JOIN public.tags t ON lower(t.name) = m.tag_name
ORDER BY m.tag_name;

-- 2. Projects carrying two or more of these tags. Must be empty: any row here
--    makes the migration fail. Fix the project's tags first.
WITH mapping(tag_name) AS (
  VALUES ('paid casual service (implement)'), ('vip client (clarify)'), ('promotional'), ('ironbrij')
)
SELECT p.name AS project, string_agg(t.name, ', ') AS category_tags
FROM public.project_tags pt
JOIN public.tags t ON t.id = pt.tag_id
JOIN mapping m ON m.tag_name = lower(t.name)
JOIN public.projects p ON p.id = pt.project_id
GROUP BY p.name
HAVING count(*) > 1;

-- 3. Entries whose category will change, by project. The accounts team's
--    heads-up: these are the rows whose billed hours may move.
WITH mapping(tag_name, category) AS (
  VALUES
    ('paid casual service (implement)', 'paid_casual'::public.casual_service_category),
    ('vip client (clarify)', 'vip_client'),
    ('promotional', 'promotional'),
    ('ironbrij', 'ironbrij')
),
project_category AS (
  SELECT pt.project_id, m.category
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  JOIN mapping m ON m.tag_name = lower(t.name)
)
SELECT
  COALESCE(p.name, '(no project)') AS project,
  te.service_category AS category_now,
  pc.category AS category_after,
  count(*) AS entries,
  round(sum(COALESCE(te.duration_seconds, 0)) / 3600.0, 2) AS tracked_hours,
  min(te.entry_date) AS earliest,
  max(te.entry_date) AS latest
FROM public.time_entries te
LEFT JOIN public.projects p ON p.id = te.project_id
LEFT JOIN project_category pc ON pc.project_id = te.project_id
WHERE te.service_category IS DISTINCT FROM pc.category
  AND NOT (te.va_paid_at IS NOT NULL AND pc.category IS NULL)
GROUP BY 1, 2, 3
ORDER BY entries DESC;

-- 4. Paid entries the migration will leave alone, because their project has
--    no category tag. Each needs a person to decide.
WITH mapping(tag_name) AS (
  VALUES ('paid casual service (implement)'), ('vip client (clarify)'), ('promotional'), ('ironbrij')
),
categorised_projects AS (
  SELECT DISTINCT pt.project_id
  FROM public.project_tags pt
  JOIN public.tags t ON t.id = pt.tag_id
  JOIN mapping m ON m.tag_name = lower(t.name)
)
SELECT te.id, te.entry_date, COALESCE(p.name, '(no project)') AS project,
       te.service_category, te.va_paid_at
FROM public.time_entries te
LEFT JOIN public.projects p ON p.id = te.project_id
WHERE te.va_paid_at IS NOT NULL
  AND te.service_category IS NOT NULL
  AND (te.project_id IS NULL OR te.project_id NOT IN (SELECT project_id FROM categorised_projects))
ORDER BY te.entry_date;
```

The first block is a standalone statement whose `WITH` covers only query 1. Each later block repeats the CTE it needs, so every query runs on its own when selected and executed individually in the SQL editor.

- [ ] **Step 2: Sanity-check it parses**

There's no local Postgres, so read it once against the schema (`tags.name`, `project_tags.project_id/tag_id`, `time_entries.service_category/va_paid_at/duration_seconds/entry_date/project_id`, `projects.name`). Every column named exists in `src/integrations/supabase/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add docs/checks/2026-10-16-category-follows-tag-precheck.sql
git commit -m "Add the read-only pre-merge check for the category change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI run and hand-off (needs the user's go-ahead)

**Files:** none new.

- [ ] **Step 1: Ask the user before pushing**

Pushing the branch runs CI and a Cloudflare *version upload*, not a production deploy (Version command fixed 2026-10-11). Migrations only apply on merge to `main`. Still ask: "Push `feat/category-from-project-tag` so CI can run the database tests?"

- [ ] **Step 2: Push and watch CI**

```bash
git push -u origin feat/category-from-project-tag
gh run watch --exit-status
```

Expected: lint, typecheck, build, tests (including the new integration block) and the types check all pass. If the types check fails, download the `supabase-types` artifact, replace `src/integrations/supabase/types.ts`, commit as "Sync types.ts with the category migration" and push again. If an integration test fails, fix the migration or the test. Don't weaken the assertion.

- [ ] **Step 3: Open the PR (with the user's OK)**

The PR description includes:
- What changed, in two sentences.
- **Before merging:** run `docs/checks/2026-10-16-category-follows-tag-precheck.sql` in the Supabase SQL editor. Query 2 must be empty. Query 3 is the accounts-team heads-up. Query 4 lists paid entries needing a decision.
- **After merging:** past billed hours, revenue and gross profit change wherever an entry's category didn't match its project's tag. Already-sent client emails are unaffected.
- Ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
