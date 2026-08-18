# Nav + Home cleanup (Aug 11 Daniel↔Allie review)

Branch `feat/nav-home-cleanup`. Presentational + one bug fix. Additive, no migration.

## 1. Leaner left nav

`apps/web/lib/navigation.ts` — dropped three sidebar items:

- **Overview** (`/dashboard`) and **Assistant** (`/assistant`) — Home already bundles
  both (assistant chat + command-center tiles, #102), so the standalone links were
  redundant clutter.
- Standalone **Daily Sync** (`/daily-sync`) — now reached from Home's Daily Sync tile.

All three **routes still resolve** (only the nav entries were removed). `Home` stays
the sole item in the top group and the landing (`/home`). `Sidebar.tsx` is fully
data-driven off `NAV_GROUPS`, so no component change was needed; unused icon imports
(`LayoutDashboard`, `MessageSquare`, `Sunrise`) were removed.

## 2. Home tweaks

`apps/web/app/(app)/dashboard/CommandCenter.tsx` (shared by `/home` rail + `/dashboard` grid):

- **Pre-meeting Briefs tile replaces the pipeline / needs-attention tile.** Lists
  today's briefs from the already-loaded daily-sync data (`content.briefs`), each
  linking to its meeting occurrence page (`/meetings/<id>`). No new query. Empty state
  when the morning sync hasn't generated briefs yet.
- **"My open tasks" tile removed** (tasks move to a report). This also drops the
  `listTasks` + `listPipelineFleet` loads — the command center now reads only the
  daily-sync row + session user.
- **Daily Sync tile is now fully clickable** → `/daily-sync` (the whole card is a link;
  the inner "View →" is now a visual cue, not a nested anchor).
- Grid narrows from 3 to 2 columns on `lg`+ (Today's meetings + Pre-meeting briefs).

`apps/web/app/(app)/home/page.tsx`:

- The right-hand tiles rail is **bounded to the viewport and scrolls on its own** on
  `lg`+ (`lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`), so a
  long tile list never stretches the page. Below `lg` it stacks and flows normally.

## 3. Bug fix — notifications dropdown rendered behind content

`apps/web/components/NotificationBell.tsx`. Root cause: the app-shell header uses
`.glass` (`backdrop-filter`), which establishes a **stacking context**. Any `z-index`
on the dropdown inside the header is confined below sibling page content — no in-header
z-index bump can escape it.

Fix: **portal the panel to `document.body`** (`createPortal`) with `position: fixed`,
anchored under the bell's right edge (`getBoundingClientRect`), `zIndex: 100`. It now
sits above all page content regardless of ancestor stacking/overflow. The outside-click
handler excludes the portaled panel (via a `panelRef`) so clicks inside it don't close
it, and the anchor recomputes on window resize.

## Gate

`pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ (all 5 workspaces). Touched files
prettier-clean. No visual/browser verification run (background PR job; the copied
`.env.local` points at live infra).
