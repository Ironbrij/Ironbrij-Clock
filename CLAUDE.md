# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"IronTrack" (Ironbrij Time) — an internal time-tracking web app for Ironbrij / Virtual Assistant
Australia, a digital agency and VA staffing company. Used only by their own staff across 13 teams;
not a public product. Originally scaffolded and still synced with [Lovable](https://lovable.dev) —
commits pushed to the connected branch sync back into the Lovable editor, so keep the branch in a
working state and avoid rewriting published git history (force-push, rebase/amend/squash of pushed
commits) per `AGENTS.md`.

## Commands

```sh
npm run dev        # starts the TanStack Start dev server (vite dev)
npm run build       # production build, nitro/cloudflare target
npm run build:dev   # development-mode build
npm run preview     # preview a production build
npm run lint         # eslint .
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run format       # prettier --write .
```

`npm run test` (vitest, config in `vitest.config.ts` — deliberately separate from `vite.config.ts`,
which is a wrapped `@lovable.dev/vite-tanstack-config` config that warns against adding plugins to
it manually) currently covers pure business logic only (`src/lib/time-utils.ts`,
`src/lib/mock-data.ts`) — date/time math, day-splitting, schedule parsing, formatters. It does not
touch the `SECURITY DEFINER` Postgres functions (`submit_timesheet`, `review_timesheet`,
`stop_timer`, etc.), which need a real Postgres instance to test against and aren't covered by any
automated suite yet; changes to those still rely on manual verification against a linked Supabase
project. `bun.lock` and `bunfig.toml` are
present alongside `package-lock.json`; `bunfig.toml` enforces a 24h supply-chain delay on new
package versions (`minimumReleaseAge`), so check with the user before adding a dependency that
needs to bypass it via `minimumReleaseAgeExcludes`.

## Architecture

**Stack**: TanStack Start (file-based SSR React framework, not plain Vite SPA) + TanStack Router +
TanStack Query, Supabase (Postgres + Auth + Realtime), Tailwind v4 + shadcn/ui (`new-york` style),
deployed to Cloudflare via `nitro`/`wrangler`.

### Routing

File-based routing under `src/routes/` — see `src/routes/README.md` for the naming conventions
(`$id` for dynamic segments, `{-$category}` for optional, `$.tsx` for splat, `_layout.tsx` for
layouts). `src/routes/__root.tsx` is the only root shell/layout — don't create `src/pages/` or
Next/Remix-style route files. `routeTree.gen.ts` is auto-generated; never hand-edit it.

### Data layer: the workspace store

Almost all app state flows through one context, `WorkspaceProvider` in `src/lib/workspace-store.tsx`,
consumed via `useWorkspace()`. It composes a set of domain hooks under `src/lib/workspace/`
(`use-members`, `use-projects`, `use-clients`, `use-teams`, `use-time-entries`, `use-timesheets`,
`use-settings`, `use-employment`, `use-tags`, `use-task-categories`, `use-activity-log`), each
wrapping TanStack Query around Supabase tables. `workspace-store.tsx` re-exports everything under
its original names so existing `@/lib/workspace-store` imports keep working — new domain logic
belongs in a `src/lib/workspace/use-*.ts` file, not bolted directly onto `workspace-store.tsx`.

Time entries only load a rolling window (`ENTRIES_HISTORY_DAYS` in `src/lib/time-utils.ts`, 400
days) — UI code that navigates history must stop honestly at `oldestLoadedWeekStart()` rather than
rendering an unfetched week as if it were empty.

Several hooks (e.g. `use-time-entries.ts`) subscribe to Supabase Realtime (`postgres_changes`) so
state updates live across tabs/devices without a manual refresh; when adding a new mutable table
that other sessions can also change, consider whether it needs the same treatment.

### Supabase clients — three, not interchangeable

- `src/integrations/supabase/client.ts` — browser client, anon key, used by `workspace/use-*` hooks
  and any client-side code. Auto-generated; don't hand-edit.
- `src/integrations/supabase/client.server.ts` — `supabaseAdmin`, service-role key, **bypasses RLS**.
  Server-only. Import it lazily inside server function handlers (`await import(...)`), never as a
  top-level import from a route file or a `*.functions.ts` module, since those ship to the client
  bundle.
- `src/integrations/supabase/auth-middleware.ts` — `requireSupabaseAuth`, a TanStack Start server-fn
  middleware that validates the caller's bearer JWT and hands the handler an RLS-scoped client plus
  `userId`/`claims`. Use this (not `supabaseAdmin`) for anything that should stay subject to RLS.

`src/integrations/supabase/auth-attacher.ts` (`attachSupabaseAuth`) is the client-side middleware
that puts the session's access token on every server-fn call; it's wired into `functionMiddleware`
in `src/start.ts` and must stay registered there or server-fn RPCs stop being authenticated.
`src/start.ts` also re-declares CSRF middleware (`createCsrfMiddleware`) — TanStack Start only adds
it automatically when `src/start.ts` is absent, so this file existing means CSRF protection has to
be kept explicit here.

Server-side privileged actions (invite/remove/resend a member) live in `src/lib/admin.functions.ts`
as `createServerFn`s guarded by `requireSupabaseAuth` + an explicit `has_role(..., 'admin')` RPC
check — new privileged mutations should follow that same pattern rather than relying on RLS alone.

### Authorization model: defense in depth, not UI-only

Business rules (locked/submitted weeks, required descriptions, manual-entry toggle, self-approval
bans, last-admin protection, etc.) are enforced at **two layers on purpose**: client-side in the
`workspace/use-*` hooks (for a fast, specific error message) and again in Postgres via RLS policies
and `SECURITY DEFINER` helper functions in `supabase/migrations/` (the real backstop). When adding
or changing a rule, update both — a client-only check is not considered done. See the commented
migrations (e.g. `20260812000000_enforce_entry_policies.sql`) for the established pattern: small
`STABLE SECURITY DEFINER` functions (`has_role`, `shares_team`, `week_is_locked`,
`description_required`, `manual_entry_allowed`, ...) composed inside policy `USING`/`WITH CHECK`
clauses, each with a `REVOKE ALL ... GRANT EXECUTE TO authenticated`.

A blocked UPDATE/DELETE under RLS doesn't raise a Postgres error — the row is just silently excluded
from the policy's `USING` clause, so the query reports success while changing nothing. The existing
hooks work around this by chaining `.select("id")` after the mutation and treating a zero-length
result as failure (see `stopTimer`/`updateEntry`/`deleteEntry` in `use-time-entries.ts`); follow the
same pattern for any new locked-row mutation.

Migration files are timestamp-prefixed and additive (`DROP POLICY IF EXISTS` + recreate, or
`CREATE OR REPLACE FUNCTION`) rather than squashed — read recent ones under `supabase/migrations/`
before changing a policy to see whether it's already been layered by a later migration.

### SSR error handling

Two separate, intentionally redundant mechanisms cover different failure layers — don't conflate
them:

- **Worker/server-fn level**: `src/start.ts`'s global error middleware and `src/server.ts`
  (Cloudflare Worker entry, wraps the TanStack Start SSR handler) both fall back to the static HTML
  from `src/lib/error-page.ts` (`renderErrorPage`) when something throws or a response comes back
  with status ≥ 500. `server.ts` additionally normalizes h3's swallowed-500 responses (h3 turns an
  in-handler throw into `{"unhandled":true,"message":"HTTPError"}` with no stack) back into that
  same error page.
- **Route level**: `src/routes/__root.tsx`'s `errorComponent` is a client-rendered React error
  boundary with its own JSX (not `renderErrorPage`), and is the only one of the three that reports
  to Lovable's telemetry via `src/lib/lovable-error-reporting.ts` (`reportLovableError`).

`src/lib/error-capture.ts` monkey-patches the global `console.error` to expand `Error` causes into
full stack/cause chains (h3's serialized errors otherwise log with no useful detail), and records
the most recent error so `server.ts` can recover it when h3 has already swallowed the original
throw. Any new error-logging code should call `console.error` as normal rather than working around
this wrapper.

### Path alias

`@/*` maps to `src/*` (see `tsconfig.json` / `components.json`). shadcn/ui components live under
`src/components/ui`; add new shadcn components through its aliases (`@/components`, `@/lib`,
`@/hooks`) rather than importing across the alias boundary.
