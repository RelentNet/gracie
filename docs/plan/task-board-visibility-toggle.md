# Task-Board visibility toggle — admin-only by default, reveal to all when ready

**Status:** built, PR open (not merged). No migration. One web redeploy makes it live.

## What the operator asked for

Keep the cross-client **Task Board** for admins, but hide it from general (non-admin)
users, with a **Settings toggle to reveal it to everyone when the team is ready.**

## What was already true (and what changed)

The brief was written against an older state where the Task Board nav item was ungated.
By the time this shipped, `main` had already made the board **admin-only** via a
`task.manageBoard` permission — gating the nav item, the `/tasks` page, and the
server-side data (`GET /api/tasks` + `GET /api/tasks/export`, both `isAdmin`).

So the "admin-only baseline" already existed. This change adds the **reveal-to-all
toggle** and threads it through **every** one of those gates, so turning it on yields a
*working* board for non-admins rather than a page that 403s on its data fetch (the
"never a button guaranteed to fail" rule).

## The setting

- Key `task_board_visible_to_all` on the scalar `settings` row (same shape as the
  `client_health_scores_visible` health-visibility toggle #82). **No migration.**
- Default **false** = admin-only. Missing/any non-`'true'` value → false.
- Helpers `getTaskBoardVisibleToAll()` / `setTaskBoardVisibleToAll()` in
  `apps/web/lib/data/tasks.ts`.

## The gate (one rule, five places)

`canSeeTaskBoard(hasBoardAccess, visibleToAll) = hasBoardAccess || visibleToAll`
(pure, in `apps/web/lib/client-display.ts`, unit-tested in `client-display.test.ts`).

- **Nav item** — `components/Sidebar.tsx` gates `/tasks` on
  `canSeeTaskBoard(can('task.manageBoard'), taskBoardVisibleToAll)`. The item's static
  `requires` was removed in `lib/navigation.ts` because the gate is now dynamic.
- **Page** — `app/(app)/tasks/page.tsx` renders a plain "Not available yet" placeholder
  (never 500s) when the gate is false.
- **Data API** — `GET /api/tasks` and `GET /api/tasks/export` now allow
  `isAdmin(user) || getTaskBoardVisibleToAll()`, failing **closed** (403, never 500) on a
  settings-read blip.
- Admins always pass the gate regardless of the toggle.

## The toggle control (admin-only)

- New route `GET/PATCH /api/settings/tasks-visibility`, gated on `settings.access`
  (mirrors the health-visibility route).
- Control lives at the top of **Settings → Company** (`CompanySettingsPanel.tsx`):
  a `ToggleSwitch` labeled **"Show the Task Board to all users"** with help text
  *"Off = only administrators see the cross-client Task Board. Turn it on when the team
  is ready…"*. Instant-save; on success it calls `router.refresh()` so the sidebar item
  appears/disappears in the same session.

## Threading

`settings.task_board_visible_to_all` → `getTaskBoardVisibleToAll()` (read in
`app/layout.tsx`, fail-open to the `false` default) → `AuthProvider` prop →
`taskBoardVisibleToAll` on the `useAuth()` context → Sidebar + `/tasks` page.

## Verification

- `pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ · `pnpm --filter web test` ✅ (68/68,
  incl. 2 new `canSeeTaskBoard` cases).
- No live preview: the LAN backend is NAT-gated, and local dev falls back to a MOCK
  **admin** (so the non-admin branch isn't exercisable without flipping `MOCK_ROLE`).
  Logic mirrors the proven health-visibility pattern; the gate decision is unit-tested.

## Deploy

Additive, no migration. One Coolify **web** redeploy (worker untouched). Default is OFF,
so nothing changes for users until the operator flips the toggle.
