# Client remaining hours: import from the sheet, and placement hours count down

Status: design, approved in chat 2026-10-30 ("lets do it")

## Problem

Accounts keeps every Paid Casual client's remaining hours by hand in the Google
Sheet **Casual Service | Monitoring** (tab "Summary Report | Per Client").
IronTrack already works out a remaining figure for each client:

```
remaining = clients.subscription_hours − every hour tracked on the client's projects
```

(`useClientBudgets` in `src/lib/workspace-store.tsx`, fed by `project_hours()`.)

The two don't agree, so nobody trusts IronTrack's figure and the sheet stays
the source. The product owner wants IronTrack to be where remaining hours are
checked, to cut accounts' manual work.

There are two gaps:

1. **No way in.** Getting the sheet's figures into IronTrack means editing
   every client's subscription hours one at a time and working out the sum by
   hand.
2. **Placement VAs don't count.** Some clients have placed VAs (category
   *Casual VA – External*) who work their casual hours but don't log time in
   IronTrack. Their hours are fixed per week. Today they don't come off the
   client's remaining hours at all, so straight after any import those clients
   would drift above the real figure.

## What was decided

From the product owner, 2026-10-30:

- The goal is for remaining hours to **match** the sheet, then IronTrack is the
  record from then on.
- Import by pasting, not by sending a file. They were worried a file upload
  could mess up the data.
- Placement VAs' hours are **fixed**, so accounts doesn't enter them weekly.
  IronTrack should subtract them by itself.
- Build both parts and release them together.

## Goals

1. Accounts can paste client names and Remaining Hours from the sheet, see
   what would change, and apply it. Repeatable, but expected to be used once.
2. Each week, every *Casual VA – External* placement's hours come off its
   client's remaining hours automatically.

## Non-goals

- No file upload, and no live link to Google Sheets.
- No importing of past time or past hours (see the 2026-09-16 cutover decision:
  IronTrack is authoritative from 2026-09-04, history stays in Sheets).
- Nothing to do with invoices (Xero).
- No change to billing, Gross Profit, Weekly P&L, uplift or increment.
- Full-Time, Part-Time, VIP VA and LMT placements don't affect remaining hours.

## Anti-goals (a failure even if it technically works)

- The import changing anything other than `clients.subscription_hours`, such as
  time entries.
- The import guessing which client a name means.
- Plain members seeing placement pay or invoice rates through the new figure.
- Remaining hours and the invoice disagreeing about a placement's week.

## Design

### Part 1: placement hours count down remaining hours

**The rule.** For each placement with `employment_type = 'casual_external'`,
take every Monday-to-Sunday week from the week it started to the week it ended
(or the latest week, if it's still live) that **has fully ended**. Each week
counts:

- the hours accounts entered for that week in `placement_week_hours`, if any;
- otherwise `contracted_weekly_hours × live days ÷ 7`, where live days are the
  days of that week between `started_on` and `ended_on` (so a mid-week start or
  end is pro-rated);
- 0 if neither exists.

This is exactly `placementWeekFigures` in `src/lib/retainer.ts`, which billing
uses, so remaining hours and the invoice always agree on a week. An entered 0
is a real zero (VA on leave), not "use the contract".

"Fully ended" is judged in the workspace timezone (`workspace_settings.timezone`,
Australia/Sydney), so balances drop once a week, on Monday, for everyone.

**Weeks before the import count too.** They're absorbed by the import (Part 2
sets subscription hours so the remaining figure lands on the sheet's number, and
the figure it starts from already includes them), so nothing is subtracted
twice. Consequence: between this release and running the import, clients with
casual placements show too few hours left. Run the import the same day.

**Where it's worked out.** A new Postgres function:

```sql
public.client_placement_hours() RETURNS TABLE (client_id uuid, hours numeric)
```

- `STABLE SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM
  PUBLIC, anon` then `GRANT EXECUTE ... TO authenticated`, like `project_hours()`.
- Returns nothing unless `is_approved(auth.uid())`, so a pending account sees
  nothing, as with the clients table.
- Returns only a total of hours per client, never a rate. That's why it can be
  open to every approved user although `va_placements` and
  `placement_week_hours` are managers-only: staff see the right "hours left"
  warning on their timer without seeing what a placed VA is paid.
- Hours rounded to 2 decimals.

**In the app.**

- `use-clients.ts` gets a `["client_placement_hours"]` query and exposes
  `clientPlacementHours: Map<clientId, hours>` through the workspace context.
  If the function doesn't exist yet (app deployed a moment before the
  migration), the query falls back to an empty map rather than failing, so
  remaining hours just behave as they do today.
- `use-placements.ts` invalidates that query whenever a placement or a week's
  hours change.
- `useClientBudgets`: `ClientBudgetStatus` gains `trackedHours` and
  `placementHours`; `renderedHours = trackedHours + placementHours`. Everything
  that already reads remaining hours (Projects → Clients badges, the client
  detail panel, the timer's low-hours warning, the entry form's over-budget
  toast, the Remaining Hours column in client exports) picks it up unchanged.
- The client profile dialog (Projects → Clients → a client) shows the same
  rendered and remaining figures as `useClientBudgets` (today it does its own
  sum from tracked hours). When a client has placement hours, a line under the
  figures says how Rendered splits: hours tracked in IronTrack and hours from
  placements.
- Messages that say hours were "logged against" an allowance now say "used",
  since placement hours aren't logged.

### Part 2: import remaining hours

**Where.** Projects → Clients, an **Import remaining hours** button next to
*Add client*, for managers (`canManage`). Managers can already edit
subscription hours (`clients_write_manage`), and accounts are managers.

**Step 1: paste.** A dialog with a text box: "Copy the client name and
Remaining Hours columns from Casual Service | Monitoring and paste them here."
Then **Preview**.

**Reading the paste** (pure functions in `src/lib/remaining-hours-import.ts`,
unit-tested):

- One line per client; blank lines ignored.
- Cells split on tabs (what Google Sheets puts on the clipboard). A line with
  no tab is split at its last space, so "Arnab Nandi 23.75" still reads.
- Name = first cell. Hours = last non-empty cell, read as a number: thousands
  commas dropped, `-` or `−` (Unicode minus) or `(23.62)` for negatives.
- A line whose hours aren't a number (the header row, a total row, a typo) is
  listed as "couldn't read", not dropped silently.

**Matching names.** Compared after trimming, lower-casing, collapsing runs of
spaces and removing accents. Exact match only. A name with no match gets a
dropdown of every IronTrack client to pick from; nothing is guessed. If two
lines point at the same client, both are flagged and neither can be applied
until one is changed.

**Step 2: preview.** One row per line:

| ☐ | Sheet name → IronTrack client | IronTrack now | Sheet | Difference | New subscription |
|---|---|---|---|---|---|

- *IronTrack now* is the current remaining figure, or "No allowance" when the
  client has no subscription hours.
- *New subscription* = sheet remaining + rendered (tracked + placement hours),
  rounded to 2 decimals.
- Hours shown as decimals (23.75), like the sheet, so they're easy to compare.
- Nothing is ticked to start with. A tick-all box ticks every row that can be
  applied and would change something.

**Apply.** Updates `subscription_hours` for the ticked clients only, each with
the same zero-row check the time-entry hooks use (`.select("id")`, empty means
RLS blocked it). Reports how many changed and lists any that failed. Nothing
else is written.

### Database changes

One migration, `20261030000000_client_placement_hours.sql`: the function above,
its grants, and a comment. Safe to re-run (`CREATE OR REPLACE`). No table or
policy changes. `src/integrations/supabase/types.ts` gets the function by hand.

## Going live

1. Merge. The migration applies on merge to main.
2. Accounts checks Billing → Placements: every placed VA who uses up a client's
   casual hours is set to *Casual VA – External*, under the right client, with
   the right hours per week.
3. The same day, accounts runs the import from Casual Service | Monitoring
   (from the sheet itself, not the PDF summary, which leaves out hidden rows).
4. From then on, remaining hours are checked in IronTrack and the sheet's
   remaining column is no longer updated.

## Tests

- **Unit** (`src/lib/remaining-hours-import.test.ts`): parsing (tabs, spaces,
  commas, negatives, header rows, blank lines), name matching (case, spaces,
  accents, no match, duplicates), the new-subscription sum.
- **Unit**: `useClientBudgets`'s arithmetic, if it's pulled into a pure helper.
- **Integration** (`rpc.integration.test.ts`), for `client_placement_hours()`:
  - a full past week counts the contracted hours; a mid-week start is pro-rated;
  - entered hours replace the contracted hours for that week, and an entered 0
    counts as 0;
  - an ended placement stops counting after its end;
  - the current, unfinished week doesn't count;
  - only *Casual VA – External* placements count;
  - a plain approved member gets the totals; a pending account gets nothing.

## Calls made without the product owner (check these)

- A week comes off once it has ended (Monday), rather than a day at a time.
- Past placement weeks are counted, then absorbed by the import, rather than
  storing a per-client start date.
- The import is for managers, not admins only.
- Nothing is ticked by default in the preview.
- The figure is open to every approved user (hours only, no rates) so staff's
  timer warnings are right too.

## Left to the builder

Layout and wording of the dialog, where exactly the rendered split appears,
and test fixture details.
