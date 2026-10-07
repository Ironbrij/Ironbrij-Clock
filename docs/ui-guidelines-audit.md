# UI Guidelines Audit (Web Interface Guidelines)

Audit performed 2026-10-06 against `src/routes/*.tsx` and `src/components/*.tsx` (excluding
`src/components/ui`), using Vercel's
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) via the
`web-design-guidelines` skill. Statuses below reflect what has shipped since.

**Scope note:** this is a UI/accessibility audit, not a logic audit — see `audit-findings.md` for
that. Nothing in the "Fixed" section changes behaviour: every change is markup, ARIA, copy or CSS.
Everything that _would_ change behaviour is listed under "Open" and needs a product decision first.

**Already in good shape:** no `outline-none` or `transition-all`, no paste-blocking, zoom is not
disabled, `tabular-nums` throughout, most destructive actions confirm via `AlertDialog`, `Intl` for
dates and currency, fonts preconnected, empty states on most lists.

---

## 1. Fixed — markup/ARIA/CSS pass (2026-10-06)

**Global (`src/styles.css`)**

- `color-scheme: light` / `dark` on `<html>` so native scrollbars, date/time pickers and form
  controls follow the active theme.
- `scroll-padding-top` so the sticky page header doesn't cover whatever keyboard focus scrolls to.
- `prefers-reduced-motion: reduce` collapses every transition/animation (dialog zoom, button scale,
  spinners) for people who've asked their OS for less motion.

**Shell & navigation (`app-shell.tsx`)**

- Page content is now a `<main id="main-content">` landmark, with a "Skip to content" link that
  appears on first Tab.
- Both navs labelled (`aria-label="Main"`).
- Full-screen loading spinners announce "Loading…" (`role="status"` + sr-only text).
- Nav badge counts read as "3 waiting on you", and the mobile "More" dot has a text equivalent.
- Mobile bottom nav respects the iPhone home-indicator area (`env(safe-area-inset-bottom)`).
- Logo `<img>` has explicit `width`/`height` (also on `login.tsx`).

**Icon-only buttons now named**

- Week/month prev/next arrows on Timesheet, Time (Grid + Calendar) and Manage → Entries.
- Timesheet and Time-grid "next week" now render disabled at the current week, matching Manage and
  Calendar (clicking it was already a no-op).
- Remove-rate / remove-placement buttons now say _which_ rate/placement.

**Form controls now labelled**

- Every filter-bar Select/Combobox (Reports, Manage, Casual Service, Billing Rates, Placements,
  Announcements, Projects, member search) has an `aria-label`. `Combobox` gained an optional
  `aria-label` prop for this.
- Timer bar: description, Project and Task fields.
- Entry dialog: Project/Task `<Label>`s now point at their triggers; the "End" label no longer points
  at a non-input `<div>` while a timer is running.
- Inline table inputs (Manage → Schedule rate/salary/type/timezone, Billing rates, Placements) say
  whose row they edit.
- Switches (billable project, workspace settings, notification previews) have accessible names.
- Group labels (colour pickers, member/tag/category checklists, company logo) wired with
  `role="group"` + `aria-labelledby`.
- Casual Service date inputs and select-all/row checkboxes.

**State & semantics**

- `DescriptionAutocomplete` exposes proper combobox/listbox ARIA, so screen readers announce
  suggestions and the highlighted one.
- Colour picker swatches expose `aria-pressed` and a visible `focus-visible` ring.
- Theme toggle exposes `aria-pressed`.
- Teams list buttons expose `aria-pressed` for the selected team.
- Approvals "expand entries" button exposes `aria-expanded`.
- Schedule day toggles announce the full day name instead of "M"/"T".
- Reports sortable columns set `aria-sort` on the `<th>`; ↑/↓ arrows hidden from screen readers.
- Reports `*` / `†` footnotes, lock icons, "Reminded" and the unrecognised-schedule dot all have
  text equivalents instead of hover-only `title`s.
- Reports total/"Loading…" and the invite email counter are `aria-live="polite"`.
- Dashboard hours-by-day bars each announce "Mon: 7h 30m"; Time Off progress bars are
  `role="progressbar"`.
- Settings user tables: `display:flex` moved off the `<td>` (it can strip table-cell semantics).

**Copy & typography**

- "1 members" → "1 member" on Teams.
- Straight quotes around user content → curly quotes (Timesheet, Time, Announcements, Manage,
  Settings).
- `...` → `…` in placeholders; `2 MB` → `2&nbsp;MB`.
- Email/URL/name inputs: `autoComplete`, `spellCheck={false}`, `name`, `type="url"` where relevant.
- Project/tag dialogs: `max-h-[90vh]` → `dvh` + `overscroll-contain`.

---

## 2. Open — needs a decision (changes behaviour)

**O1. ✅ Fixed 2026-10-06.** Project and tag cards on `/projects` were `<Card onClick>` with no
keyboard path. The card title is now a real `<button>` (the whole card stays mouse-clickable), and
the card shows a focus ring while that button has keyboard focus.

**O2. ✅ Fixed 2026-10-06.** Previous/Next were `<a>` with no `href`, so Enter did nothing and
"disabled" was only `pointer-events-none`. Added `PaginationPreviousButton`/`PaginationNextButton`
to `ui/pagination.tsx` (real `<button>`s with a real `disabled`) and switched all four paged lists
(Projects, Clients, Settings → Users, Reports → Detailed) to them. The link versions are unchanged
for any future URL-based paging.

**O3. ✅ Fixed 2026-10-06.** One-click destructive actions now either confirm or offer Undo,
depending on whether they can be reversed:

- **Confirm dialog** (irreversible): remove billing rate (explains reports fall back to another rate
  or show the work as unpriced), remove placement (points to "end it instead" to keep history),
  remove task category (warns that a project scoped to only that category reverts to offering all
  of them — `project_task_categories` cascades on delete).
- **Undo in the success toast** (cheaply reversible): remove member from team (re-adds the
  `team_members` row; only its `created_at` resets, and Activity shows both events), end/reopen
  placement (restores the exact previous end date).

**O4. ✅ Mostly fixed 2026-10-06.**

- **Settings:** `?tab=` drives the tabs. The Dashboard's pending-signups "Review" link now goes to
  `?tab=users`; a non-admin following that link lands on Profile instead of a blank panel.
- **Manage:** tab changes now write `?tab=` back (it already read it), dropping any stale
  member/week deep-link.
- **Reports:** view, range (plus custom from/to), team, client, tag and audience are mirrored into
  the URL, so a filtered report can be shared as a link. A non-manager following a link to a
  manager-only tab gets By project.
- All use `replace`, so changing a filter doesn't add Back-button history; defaults are omitted.
- **Still open (lower value):** Time view/calendar mode, Timesheet week, Projects tab, and the
  Reports per-tab extras (detailed search, project/employee filters, group-by).

**O5. ✅ Fixed 2026-10-06.** Validation errors now appear under the field they're about (linked
with `aria-invalid` + `aria-describedby` so screen readers read them), clear as soon as that field
is edited, and on submit focus jumps to the first invalid field in page order. Covers the entry
dialog (description when required, project, start, end), Settings → Admin (weekly hours, uplift,
increment, inactivity days — messages now say what a valid value is), the tag form (name) and the
announcement composer (title, message, team selection — this used to do nothing at all on an empty
title/body). Server/network failures still use toasts, since they aren't about any one field.

**O6. ✅ Fixed 2026-10-06.** "Save workspace settings" now disables and reads "Saving…" while the
request is in flight, so it can't be double-submitted. The Invite, Team and Project dialogs used to
close before their request finished, so a failure surfaced after the typed input was gone. They now
wait, show "Sending…"/"Saving…", close only on success, and stay open with the form intact on
failure (the parent `onSubmit`/`onInvite` now return the promise instead of swallowing it). If a
team rename fails, its membership changes are no longer applied. "Posting…" / "Saving…" labels also
added to Post announcement, Profile save and the entry dialog, which were already disabled while
busy.

**O7. ✅ Fixed 2026-10-06.**

- **Settings → Profile and Settings → Admin** render a new `UnsavedChangesGuard`
  (`src/components/unsaved-changes-guard.tsx`, built on TanStack Router's `useBlocker`). While a
  field differs from what's saved, leaving the page — including switching Settings tabs, which
  unmounts the form — asks "Leave without saving?", and refresh/close gets the browser's own
  warning. The avatar uploads immediately, so it never counts as unsaved.
- **Entry dialog:** closing with edits (Esc, outside click, ✕ or Cancel) asks "Discard your
  changes?" first. On a new entry, billable/service category only count once deliberately touched,
  since they auto-follow the chosen project.
- **Not covered:** the other dialogs (announcement composer, project/team/client/tag forms) still
  close without asking. Same pattern applies if wanted.

**O8. ✅ Fixed 2026-10-06.** Dark mode used to be applied in `ThemeToggle`'s `useEffect`, so
dark-mode users saw a light flash on every load, and pages without the toggle (login, the loading
screen) never went dark at all. An inline script (`themeInitScript` in `src/lib/theme.ts`) now runs
first in `<head>` and sets the class before paint. `ThemeToggle` reads that class back instead of
re-deciding, and `<html>` has a scoped `suppressHydrationWarning` for the class difference. Storage
access is wrapped in try/catch. Default is still light. **Not done:** following the OS dark-mode
preference when someone has never toggled — that's a one-line change in the script if wanted, but
it would switch existing staff who use OS dark mode to dark without them asking.

**O9. ✅ Fixed 2026-10-06** without adding a virtualization dependency:

- **Reports → Gross Profit, client-facing table** (up to 5,000 rows) is now paged at 50, like
  Detailed. The total row and the CSV export still cover every line.
- **Manage → Casual Service** is paged at 50. "Select all" still means every entry in the current
  filter across all pages (its label says so), so bulk "Mark as paid" behaves as before.
- **Tag entries dialog** (up to 200) and **Manage → Activity** rows use CSS
  `content-visibility: auto`, so the browser skips laying out rows that are off-screen.

**O10. ✅ Fixed 2026-10-06.** Project/tag/team chips drew text in the raw colour on a 14% tint of
itself — measured as low as **2.39:1** (light) / **3.07:1** (dark) across `dotColors`, under WCAG
AA's 4.5:1. A shared `tintedChipStyle()` (`src/lib/chip-style.ts`) now mixes the text 60/40 towards
the theme's foreground, giving **≥ 4.99:1** for every palette colour in both themes while keeping
the hue. Applied to all seven chip sites (Time calendar, Projects cards and tags, Clients, Tags tab,
Reports Detailed and Casual). The `text-[10px]` sizes were left as-is.

**O11. ✅ Fixed 2026-10-06.** Email/password/Sign in are now a real `<form onSubmit>`: Enter submits
natively, password managers recognise the fields, and Enter can no longer fire a second sign-in
while one is in flight. "Sign in with Google" is outside the submit path (`type="button"`).

**URL state, remainder of O4. ✅ Fixed 2026-10-06.** Time (`?view=grid|calendar`, `?cal=week`),
Timesheet (`?view=list`, `?week=YYYY-MM-DD` — snapped to Monday and clamped to the loaded range)
and Projects (`?tab=clients|tags`) now keep their state in the URL, same `replace`/defaults-omitted
rules as the others.

---

## 3. Rules deliberately not applied

- **"Title Case for headings and buttons."** The app consistently uses sentence case, which the
  `redesign-existing-projects` skill also recommends. Not worth the churn.
- **`autoFocus` usage.** All six uses are justified (confirm-to-delete inputs and a just-revealed
  field).
