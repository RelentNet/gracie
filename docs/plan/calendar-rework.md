# Calendar rework — work-week view, agenda-left/calendar-right, collapsible attendees

Branch: `feat/calendar-workweek-layout` · presentational/layout only, additive.

Three operator + Allie requests against the Calendar page. No data-fetching,
org-link, or create-client logic changed — only where things render.

## 1. Week view = work week (Mon–Fri)

`components/WeekView.tsx` now renders only Monday–Friday. The week grid still
comes from `buildWeekGrid` as a Sun-start 7-cell array (unchanged, so the
meetings fetch window and any weekend `selectedDay` in the shared DayDetail keep
working); the component slices it to `cells.slice(1, 6)` and drops to
`sm:grid-cols-5`. `WEEKDAYS[i + 1]` keeps the day labels aligned.

The week header label in `page.tsx` now spans Monday (cell 1) → Friday (cell 5)
instead of Sun → Sat.

## 2. Layout swap + wider calendar

`page.tsx`:

- Day agenda (`DayDetail` + `ConnectionPanel`) moved to the **LEFT** as a narrow
  sidebar; the **calendar** moved to the **RIGHT** and widened.
- Grid went `lg:grid-cols-3` (calendar 2/3, agenda 1/3) → `lg:grid-cols-4`
  (agenda 1/4, calendar 3/4), so the calendar reclaims horizontal space and both
  Month and Week cells are large enough to read meeting titles. Month/Week grids
  are flexible (`grid-cols-7` / `grid-cols-5`), so they widen automatically.
- `PageContainer` bumped `xl` → `2xl` to reclaim page width. Outer `<main>`
  padding is app-shell-global and intentionally left untouched (changing it would
  affect every page, not just Calendar).

## 3. External attendees → collapsible, collapsed by default

`components/DayDetail.tsx`: the external-attendees list plus the
create-client/prospect/lead/partner + "Link an existing org" action block are now
inside a single native `<details>` (collapsed by default) with an
`External attendees (N)` summary. Native `<details>`/`<summary>` matches the
existing lightweight expander pattern in `meetings/[id]/page.tsx` and
`daily-sync/page.tsx` — no new component or state. The visible "No client" amber
badge stays outside the dropdown, so meetings needing assignment are still
flagged at a glance.

## Gate

`pnpm -r typecheck` + `pnpm -r lint`. Preview-verified where the LAN backend was
reachable; otherwise typecheck/lint only (noted in the PR).
