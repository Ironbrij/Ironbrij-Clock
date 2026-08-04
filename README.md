# Ironbrij Time Tracker

Build the frontend for an internal time-tracking web app for Ironbrij, 

called "Ironbrij Time" (Ironbrij / Virtual Assistant Australia is a digital 

agency and VA staffing company — this app is for internal use only by our 

own staff across 13 teams, not a public product).

VISUAL STYLE

- Modern, clean, minimal SaaS dashboard — think Linear or Notion-level 

  polish, not a busy admin panel

- I'm attaching our logo — extract the primary brand color and use it as 

  the accent/primary color throughout (buttons, active nav states, the 

  timer, links). Keep the rest of the palette neutral (white/light gray 

  backgrounds, dark gray text) so the brand color stands out rather than 

  competing with itself

- Generous white space, rounded corners (not sharp, not overly bubbly), 

  subtle shadows only on elevated elements like cards and modals

- Clean modern sans-serif typography with a clear size hierarchy between 

  page titles, section headers, and body text

- Light mode by default, with a dark mode toggle

- Left sidebar navigation (not top-nav only) — this is a multi-page tool 

  people will live in daily

- UI copy tone: professional but warm and human, not cold or corporate — 

  a little personality is fine in empty states and confirmations

PAGES TO BUILD (frontend only, use realistic mock/sample data — no 

backend wiring yet)

1. Login — centered card, our logo at the top, email/password fields, a 

   "Sign in with Google" button, minimal and clean

2. Dashboard (main landing page after login)

   - Large, prominent timer at the top: start/stop button, live-updating 

     elapsed time, dropdowns to pick project + task, a text field for a 

     description

   - Today's total tracked time

   - A simple list of today's time entries below the timer — project, 

     description, duration — editable inline

3. Timesheet — a weekly grid view: days of the week across the top, 

   projects down the side, hours in each cell, with a toggle to switch to 

   a simple chronological list view. Include a week-picker to navigate 

   between weeks

4. Projects — a list/grid of projects, each showing a colored tag, the 

   client or internal team it belongs to, assigned members (avatars), and 

   total hours logged. Include a "New project" button (non-functional 

   for now)

5. Teams — a list of our 13 internal teams, each showing team name, 

   member avatars, and member count. Clicking a team shows its members 

   with their roles (Admin / Manager / Member)

6. Reports — a date range picker at the top, a bar chart showing hours by 

   project below it, and a sortable table breakdown underneath. Include 

   an "Export" button (non-functional for now)

7. Settings — a simple tabbed layout: Profile (name, avatar, email), 

   Notifications (toggle list), and an Admin tab (visible in this mockup) 

   for workspace-level settings

COMPONENT NOTES

- The timer is the centerpiece of the whole app — make the start/stop 

  button large and satisfying to click, with elapsed time updating live

- Use card-based layouts for dashboard widgets, not dense tables 

  everywhere

- Tables should look clean and scannable, not like a spreadsheet

- Use small colored dots/tags for projects instead of full-color rows — 

  keep it subtle

- Populate every page with realistic sample data (a handful of projects, 

  around 10 sample team members spread across a few of the 13 teams, a 

  week of sample time entries) so the design can be reviewed properly

Don't connect this to a real backend yet — we'll wire up Supabase once 

the design is approved.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f7420b78-2438-4cfa-87f4-2fdee818b500).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
