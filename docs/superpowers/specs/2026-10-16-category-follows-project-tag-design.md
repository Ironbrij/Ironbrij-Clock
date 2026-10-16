# Service category follows the project's tag

Status: design, awaiting review (2026-10-16)

## Problem

Whether an entry gets the Paid Casual increment (20% uplift, rounded up to
0.25h) is decided by `time_entries.service_category`, a per-entry dropdown
labelled "optional". The project's tag looks like it decides this but doesn't.
In the 1–16 October Detailed export:

- 12 entries on projects tagged "Paid Casual Service (Implement)" got no
  increment, because their own category wasn't Paid Casual.
- 30 entries got the increment even though their project is tagged "Ironbrij"
  or "VIP Client (Clarify)", because their category was Paid Casual. They
  include internal stand-ups, which then count as client work for "Louis
  Swart".

Causes: timer-started entries never get a category (`startTimer` doesn't set
one, and the dropdown is hidden while a timer runs), and the manual-entry form
pre-fills the category from the person's last entry for that client, so one
wrong pick repeats.

## What was decided

From the product owner, 2026-10-16:

- A project is only ever one kind of work. A Paid Casual project only has
  Paid Casual work.
- The project's tag is the only label. Nothing per entry.
- Only the internal team's Paid Casual work gets the increment. Placed
  (external) VAs will later do casual work **without** the increment. That is
  a future change and is out of scope here (see "Later").

## Design

### 1. Tags carry the billing meaning

Add `tags.service_category public.casual_service_category NULL`. A tag linked
to a category is a *category tag*. Every other tag works exactly as now.

| Tag (existing) | Linked to |
|---|---|
| Paid Casual Service (Implement) | `paid_casual` |
| VIP Client (Clarify) | `vip_client` |
| Promotional | `promotional` |
| Ironbrij | `ironbrij` |

The link points at the tag row, so renaming a tag doesn't change billing.

Only **admins** can set or change a tag's category, because it changes
billing for every entry on every project that has the tag. Managers keep
everything they can do with tags today (create, rename, recolour, delete, tag
projects).
- Enforced in the hook, which shows a clear message.
- Also enforced in Postgres by a `BEFORE UPDATE OR INSERT` trigger on `tags`
  that rejects a change to `service_category` unless `has_role(auth.uid(), 'admin')`.
  RLS can't restrict one column for one role, so this needs a trigger, the same
  approach as `guard_profile_privileged_columns`.

### 2. One category per project

A project may have at most one category tag. Two category tags that link to
the same category also count as a conflict, to keep the rule simple.
- **Database:** a constraint trigger on `project_tags` (insert/update) rejects a
  second category tag on a project. The `tags` trigger also rejects linking a
  tag to a category when that would give some project two category tags.
- **Client:** the project form's tag picker blocks picking a second category
  tag and says why.

### 3. Entries follow automatically

`time_entries.service_category` stays as a column. Reports, the Casual Service
tab, client health, `casual_report_for_client()` and the paid-date constraint
all keep reading it unchanged. It becomes derived, the same way `tag_ids` is:

- New function `project_service_category(_project_id uuid)`: the category of
  the project's category tag, or NULL. `STABLE SECURITY DEFINER`, granted to
  `authenticated`.
- The existing `sync_entry_tags_from_project()` trigger also sets
  `NEW.service_category := project_service_category(NEW.project_id)`.
- The trigger changes from `BEFORE INSERT OR UPDATE OF project_id` to
  `BEFORE INSERT OR UPDATE OF project_id, service_category`. A client that
  sends its own category therefore has it overwritten. The value always comes
  from the project.
- `retag_project_entries()` (the "Also apply to entries already logged"
  tickbox) also rewrites `service_category`, and its count includes entries
  whose category changed.
- `delete_tag()`: deleting a category tag recomputes the category on that
  tag's projects' entries.
- Linking or unlinking a tag's category re-syncs entries on every project with
  that tag. This runs in an `AFTER UPDATE` trigger on `tags`, so it sees the
  new value; the admin check in section 1 is the `BEFORE` one. An admin
  changing the mapping is a deliberate billing change, so it applies to past
  entries as well.
- The four side-effect guards from `20261014000000` currently return early
  when `tag_ids` is the only column that changed. They now return early when
  only `tag_ids` and/or `service_category` changed. That keeps bulk rewrites
  from moving `entry_date`, writing activity-log rows or flagging approved
  weeks.

### 4. Entry form

- Remove the "Casual service category (optional)" dropdown, its pre-fill
  (`lastCategoryByClient`) and the "Carried over from…" hint.
- In its place, show a read-only line when the chosen project has a category:
  "Billed as Paid Casual Service (from the project's tag)." Nothing is shown
  for projects without one.
- `createEntry`/`updateEntry` stop sending `service_category`.

### 5. Reports

- Add a **Category** column to the Detailed table and its CSV export, so a row
  shows why it did or didn't get the increment.
- No other report logic changes.

### 6. One-off backfill (in the migration)

1. Link the four tags by case-insensitive name match.
2. Set every entry's `service_category` from its project. Only rows that
   differ are touched, with the guards in place.

**Paid-date conflict.** `time_entries_va_paid_requires_category` forbids a
paid date on an entry with no category. An entry already marked paid whose
project has no category tag would break the migration.
- The backfill skips those rows and leaves them as they are, raising a NOTICE
  with the count.
- They are expected to be rare, and the pre-merge check below lists them.

### Pre-merge check (production, read-only)

Migrations apply automatically when merged to `main`. Before merging, run a
read-only query in the Supabase SQL editor that lists:

- projects that would end up with two category tags (the migration would
  fail)
- entries whose category will change, as counts by project
- paid entries the backfill would skip
- any of the four tag names not found

The query goes in the PR description.

## Effects to tell the accounts team

- Billed hours, revenue and gross profit **for past periods change**, because
  billing is recalculated at report time. That includes the 42 entries above.
- Client health ("last casual service") may change for some clients.
- Client emails already sent are unaffected. Re-sending a week may show
  different hours.

## Testing

Integration tests in `rpc.integration.test.ts`:
- An insert on a category-tagged project gets the category, including a timer
  start (no end time).
- A category sent by the client is overwritten. Moving an entry to another
  project updates its category.
- Adding a second category tag to a project is rejected.
- Linking a tag that would cause a conflict is rejected.
- A non-admin manager can't change a tag's category but can still rename it.
- Linking or unlinking a tag re-syncs entries. `retag_project_entries` and
  `delete_tag` update the category.
- A category-only rewrite doesn't change `entry_date`, write `activity_log` or
  flag an approved week.
- Paid entries are left intact.

Plus lint, typecheck, unit tests and the hand-maintained `types.ts`, which gets
the new column and the new function.

## Out of scope / later

- **Placed VAs.** When they start logging casual work, the increment rule in
  `billableHoursForCasualEntry` and `casual_billed_hours()` becomes
  "Paid Casual **and** an internal team member". That's a parameter on both
  functions; nothing here blocks it.
- Showing the category on the Time page or timesheets.
