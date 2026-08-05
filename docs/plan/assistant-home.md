# Assistant home — land on Gracie, keep the command-center tiles

**Branch:** `feat/assistant-home` · **Status:** built, gate-green, PR open (do not merge)

## Decision

Operator + team: opening the app should land you on **Gracie the assistant**
(ready to talk immediately), while the #83 Overview command-center tiles
(today's meetings, my open tasks, needs-attention) stay **on that same landing**
— not thrown away.

## What shipped

A new default landing at **`/home`** that composes the two existing surfaces
side by side, reusing both as-is:

- **Assistant** — the standalone `/assistant` experience (conversation list +
  streaming chat + attach), the wide main column.
- **Command center** — the #83 tiles, in a right rail.

Layout: `lg`+ → assistant (main, `flex-1`) beside a `w-80`/`xl:w-96` tiles rail.
Below `lg` → they stack, **assistant first** (so you can still type right away),
tiles a short scroll down. Theme-aware and responsive (inherits the existing
components' behaviour verbatim).

## How (reuse over rebuild)

- **Extracted** the #83 tiles + their data-loading out of
  `app/(app)/dashboard/page.tsx` into `app/(app)/dashboard/CommandCenter.tsx`
  (`<CommandCenter variant="grid" | "rail" />`). No behaviour change — the same
  best-effort `Promise.all`, the same tiles.
  - `variant="grid"` (Overview page): page header + 3-across grid on `lg`+.
  - `variant="rail"` (landing): single-column stack, page header dropped (the
    chat owns the landing).
- `dashboard/page.tsx` now just renders `<CommandCenter variant="grid" />` inside
  `PageContainer` — the standalone **Overview** is byte-for-byte the same view.
- `home/page.tsx` renders `AssistantPage` (imported from `../assistant/page`) +
  `<CommandCenter variant="rail" />`.

## Routing & nav

- Default landing repointed `/dashboard` → `/home` in: root redirect
  (`app/page.tsx`), post-login callback, dev sign-in, the sidebar logo link, and
  the 404 "back home" button.
- Nav (`lib/navigation.ts`): **added** `Home → /home` at the top (additive).
  `Overview → /dashboard` and `Assistant → /assistant` stay in the sidebar, so
  both standalone surfaces remain reachable and discoverable.

## Not done / trade-offs

- On the landing the assistant shows its own conversation-list pane; on a narrow
  desktop (assistant list + chat + tiles rail) it's a touch dense — the
  standalone `/assistant` and `/dashboard` remain for a roomier single view.
- Kept `Overview` in the nav (additive) rather than removing it; drop it later if
  the merged Home makes it redundant.
- No new components, deps, or migrations. Presentational + routing only.

## Gate

`pnpm -r typecheck` + `pnpm -r lint` green. Backend not exercised from this
worktree (LAN/VPN) — the landing is a pure composition of two already-live
surfaces, so no new data paths to verify.
