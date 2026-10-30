# Remaining Hours Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Casual VA – External placements' weekly hours count down their client's remaining hours, and accounts can paste each client's remaining hours from the Casual Service | Monitoring sheet to set IronTrack's figures to match.

**Architecture:** A `SECURITY DEFINER` Postgres function totals finished placement weeks per client (hours only, no rates) so every approved user gets the same figure. `useClientBudgets` adds it to tracked hours. A pure, unit-tested module parses and matches the paste; a dialog on Projects → Clients previews and applies it by writing `clients.subscription_hours` only.

**Tech Stack:** TanStack Start + React, TanStack Query, Supabase (Postgres, RLS), shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-remaining-hours-import-design.md`

## Global Constraints

- Only `employment_type = 'casual_external'` placements count.
- A week counts only once it has fully ended, judged in `workspace_settings.timezone`.
- Week hours = entered `placement_week_hours.hours`, else `contracted_weekly_hours × live days ÷ 7`, else 0 (same as `placementWeekFigures` in `src/lib/retainer.ts`). Entered 0 is a real 0.
- The function returns hours per client only, never a rate, and nothing unless `is_approved(auth.uid())`.
- The import writes `clients.subscription_hours` and nothing else. New subscription = sheet remaining + rendered (tracked + placement), rounded to 2 decimals.
- Never guess a name match. Nothing ticked by default.
- App must keep working if the function doesn't exist yet (deploy before migration): fall back to an empty map.
- `src/integrations/supabase/types.ts` is maintained by hand; update it with the function.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git commit -F <file>`.

## Review Focus

1. Accounts copies more than two columns (Client, Total, Rendered, Remaining): the last cell must be taken as remaining. Test in Task 3.
2. The header row or a total row is pasted: listed as "couldn't read", not applied or silently dropped. Test in Task 3.
3. Negative remaining (Kim Wasley −23.62), written `-23.62`, `−23.62` or `(23.62)`, and thousands commas (`1,225.24`): read correctly. Test in Task 3.
4. Windows line endings and trailing spaces/tabs from the clipboard: don't break names or numbers. Test in Task 3.
5. A placement with no contracted hours and no entries, or one that starts in the future: contributes 0, never NULL. Test in Task 1.

---

### Task 1: `client_placement_hours()` function

**Files:**
- Create: `supabase/migrations/20261030000000_client_placement_hours.sql`
- Modify: `src/integrations/supabase/types.ts` (Functions section, alphabetical, next to `casual_*`/`client_*` entries)
- Test: `src/lib/workspace/rpc.integration.test.ts` (new `describe("client_placement_hours", …)` inside the main describe)

**Interfaces:**
- Produces: RPC `client_placement_hours` — `Args: never`, `Returns: { client_id: string; hours: number }[]`.

- [ ] **Step 1: Write the integration tests.** Fixture: a client, a placed VA, placements inserted with the service-role `admin` client. Read `workspace_settings.timezone` with `admin`, compute "this week's Monday" in that zone with `Intl.DateTimeFormat("en-CA", { timeZone })`, and derive dates from it (`M` = this Monday). Tests (called as `plainMember`, an approved member, unless stated):
  - `casual_external`, `started_on = M − 14`, live, `contracted_weekly_hours = 10` → `hours === 20` (two finished weeks; current week excluded).
  - Same placement, plus a `placement_week_hours` row `{ week_start: M − 7, hours: 0 }` → `hours === 10`.
  - `started_on = M − 19` (Wednesday of week M − 21), `ended_on = M − 8` (Sunday of week M − 14), contracted 7 → `5 + 7 = 12`.
  - A `full_time` placement on the same client adds nothing.
  - A `casual_external` placement with `contracted_weekly_hours = null` and no entries, and one with `started_on = M + 7`: the client's total is unchanged and is a number, not null.
  - A pending fixture user (`{ pending: true }`) gets `[]`.
  Use one client per scenario so totals don't mix; clean up in `afterAll`.

- [ ] **Step 2: Write the migration.** `CREATE OR REPLACE FUNCTION public.client_placement_hours() RETURNS TABLE (client_id uuid, hours numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`. Approach: `today` from `now() AT TIME ZONE` the workspace timezone (fallback `'Australia/Sydney'`); `last_week` = Monday of today's week − 7, using ISO day-of-week date arithmetic (no `date_trunc` on `date`, which goes through the session timezone); `generate_series` of Mondays per placement from its start week to `LEAST(last_week, end week)`; live days = `LEAST(COALESCE(ended_on, ws + 6), ws + 6) − GREATEST(started_on, ws) + 1`; skip `days <= 0`; `LEFT JOIN placement_week_hours`; `ROUND(SUM(COALESCE(entered, contracted * days / 7.0, 0)), 2)` grouped by client; `WHERE public.is_approved(auth.uid())`. Then `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`. Header comment explains why it's open to members (hours only) and that it mirrors `placementWeekFigures`.

- [ ] **Step 3: Add the function to `types.ts`.**

- [ ] **Step 4: Verify.** `npm run typecheck` passes. The integration tests can't run locally (no Docker); they run in CI on the PR. Re-read the SQL against each test by hand.

- [ ] **Step 5: Commit.**

### Task 2: Placement hours in remaining hours

**Files:**
- Create: `src/lib/client-budget.ts`, `src/lib/client-budget.test.ts`
- Modify: `src/lib/workspace/use-clients.ts`, `src/lib/workspace/use-placements.ts`, `src/lib/workspace-store.tsx` (context type + value, `ClientBudgetStatus`, `useClientBudgets`), `src/routes/projects.tsx` (`ClientProfileDialog`), `src/routes/time.tsx:310,475`, `src/components/entry-form-dialog.tsx:300`

**Interfaces:**
- Consumes: RPC `client_placement_hours` (Task 1).
- Produces:
  - `clientBudgetStatus(subscriptionHours: number, trackedHours: number, placementHours: number): Omit<ClientBudgetStatus, "clientId">` in `src/lib/client-budget.ts`, with `BUDGET_WARNING_THRESHOLD = 0.9` moved there.
  - `ClientBudgetStatus` gains `trackedHours: number; placementHours: number`; `renderedHours = trackedHours + placementHours`.
  - Workspace context: `clientPlacementHours: Map<string, number>`.
  - `useClientRenderedHours(): Map<string, { trackedHours: number; placementHours: number }>` exported from `workspace-store.tsx`, covering every client (with or without a subscription). Task 4 uses it.

- [ ] **Step 1: Failing unit tests** in `client-budget.test.ts`: `(40, 30, 6)` → `renderedHours 36, remainingHours 4, isNearLimit true, isOver false`; `(40, 30, 10)` → `remainingHours 0, isOver true`; `(40, 10, 0)` → `isNearLimit false`.
- [ ] **Step 2: Run** `npx vitest run src/lib/client-budget.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `clientBudgetStatus`; make `useClientBudgets` use it.
- [ ] **Step 4: Query.** In `use-clients.ts`, `useQuery({ queryKey: ["client_placement_hours"], enabled, … })` calling `supabase.rpc("client_placement_hours")`; on error return `[]` and `console.error` once (deploy-before-migration). Return `clientPlacementHours` as a `Map`. Wire through `workspace-store.tsx`.
- [ ] **Step 5: Invalidate** `["client_placement_hours"]` in `use-placements.ts`'s `invalidate()` and after `setPlacementWeekHours` succeeds (both branches).
- [ ] **Step 6: Profile dialog.** `ClientProfileDialog` takes `trackedHours` and `placementHours` (from `useClientRenderedHours`) instead of computing from `client.hours`; Rendered = their sum; when `placementHours > 0`, a muted line: "{tracked} tracked in IronTrack + {placement} from placements".
- [ ] **Step 7: Wording.** "logged against a … allowance" → "used of a … allowance" in the three messages.
- [ ] **Step 8: Verify** `npm run test`, `npm run typecheck`, `npm run lint` pass.
- [ ] **Step 9: Commit.**

### Task 3: Parse and match the paste

**Files:**
- Create: `src/lib/remaining-hours-import.ts`, `src/lib/remaining-hours-import.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ParsedLine = { line: number; name: string; hours: number };
  type UnreadLine = { line: number; text: string };
  parseRemainingHoursPaste(text: string): { rows: ParsedLine[]; unread: UnreadLine[] };
  parseHoursCell(cell: string): number | null;
  normaliseClientName(name: string): string;
  matchClientNames(rows: ParsedLine[], clients: { id: string; name: string }[]): Map<number, string | null>; // line → client id
  newSubscriptionHours(sheetRemaining: number, renderedHours: number): number; // rounded to 2 dp
  ```

- [ ] **Step 1: Failing tests:**
  - `parseHoursCell`: `"23.75"→23.75`, `"1,225.24"→1225.24`, `"-23.62"→-23.62`, `"−23.62"→-23.62`, `"(23.62)"→-23.62`, `" 8.99 "→8.99`, `"Remaining Hours"→null`, `""→null`.
  - `parseRemainingHoursPaste("Client\tRemaining Hours\r\nArnab Nandi\t23.75\r\n\r\nKim Wasley\t-23.62\n")` → rows `[{line:2,name:"Arnab Nandi",hours:23.75},{line:4,name:"Kim Wasley",hours:-23.62}]`, unread `[{line:1,text:"Client\tRemaining Hours"}]`.
  - Four columns `"Jo Jackson\t320\t311.25\t8.75"` → hours `8.75`.
  - No tab `"Arnab Nandi 23.75"` → name `"Arnab Nandi"`, hours `23.75`.
  - Trailing tab `"Jo Jackson\t8.75\t"` → hours `8.75`.
  - `normaliseClientName("  Tammy  L   Schwinegruber ")` equals `normaliseClientName("tammy l schwinegruber")`; `normaliseClientName("Zoë")` equals `normaliseClientName("Zoe")`.
  - `matchClientNames`: exact-after-normalising → id; unknown → `null`.
  - `newSubscriptionHours(23.75, 776.2333) === 799.98`; `newSubscriptionHours(-23.62, 1248.86) === 1225.24`.
- [ ] **Step 2: Run** `npx vitest run src/lib/remaining-hours-import.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Normalise with `NFKD`, strip combining marks, lower-case, collapse whitespace, trim. Strip a trailing `\r` per line.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 4: Import dialog on Projects → Clients

**Files:**
- Create: `src/components/import-remaining-hours-dialog.tsx`
- Modify: `src/lib/workspace/use-clients.ts` (+ context in `workspace-store.tsx`), `src/routes/projects.tsx` (`ClientsTab` button)

**Interfaces:**
- Consumes: Task 2's `useClientBudgets`, `useClientRenderedHours`; Task 3's functions.
- Produces: `setClientSubscriptionHours(id: string, hours: number): Promise<void>` in `use-clients.ts` and the workspace context — updates only `subscription_hours`, chains `.select("id")`, throws `"Couldn't update that client's hours."` on zero rows, invalidates `["clients"]`.

- [ ] **Step 1: Add `setClientSubscriptionHours`.**
- [ ] **Step 2: Dialog, step 1:** textarea with the copy from the spec, **Preview** disabled while empty.
- [ ] **Step 3: Dialog, step 2:** table per the spec (tick, sheet name → client or a `Select` of all clients sorted by name, IronTrack now or "No allowance", Sheet, Difference, New subscription; decimals to 2 places). "Couldn't read" lines listed under the table. Two rows on one client: both flagged "Same client twice", not tickable. Rows with no difference (< 0.005) show "No change" and aren't ticked by tick-all. Nothing ticked by default. **Back** returns to the paste.
- [ ] **Step 4: Apply:** `setClientSubscriptionHours` for ticked rows in sequence; toast "Updated N clients"; list failures and keep the dialog open if any failed, else close.
- [ ] **Step 5: Button** "Import remaining hours" beside "Add client", `canManage` only.
- [ ] **Step 6: Verify** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` pass. Run the app (`npm run dev`) and paste the PDF's rows into the dialog to see the preview, without applying.
- [ ] **Step 7: Commit.**

### Task 5: Finish

- [ ] Update the accounts SOP doc ("Proposed" steps now built; name the button "Import remaining hours").
- [ ] Push the branch with `git push origin feat/remaining-hours-import:feat/remaining-hours-import`. Don't open or merge the PR.
