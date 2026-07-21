# Delegation Brief — RL (pass 1): Responsive Foundation + Collapsible/Sticky Nav

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §0.2 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Next.js app-router web in `apps/web`. **Tailwind v4** (CSS config at `apps/web/styles/theme.css`).
> **P9 is shipped — no parallel constraint.** This brief is RL **pass 1 (foundation) only** — the shell, nav, and reusable primitives. Do NOT retrofit individual pages here; that's the pass-2 sweep. Touch ONLY the §0.1 files.
> **Branch + PR for review. Do NOT push to `main`.**

---

## 0. What this is
"RL — Responsive & Mobile" is a phase to make the whole app responsive (desktop reflow + tablet + mobile) with a collapsible, sticky main nav. It runs in **two passes**; **this brief is PASS 1 only: the FOUNDATION** — the app shell, the navigation, and the reusable responsive primitives. It deliberately does **NOT** retrofit individual pages (that's pass 2, which sweeps every page — including the P9 Settings/Pipeline pages and the big Calendar page — once the foundation exists).

P9 is already shipped, so there's no parallel constraint. Pass 1 still stays scoped to the shell/nav/primitives (not individual pages) — purely to keep the PR clean and reviewable and to establish the responsive system before it's applied page-by-page in pass 2.

### 0.1 YOUR territory (touch ONLY these)
| Concern | File(s) |
|---|---|
| Main nav — the 3 states | `apps/web/components/Sidebar.tsx` |
| App shell — one scroll container, sticky header, hamburger | `apps/web/app/(app)/layout.tsx` |
| Top bar (hamburger trigger lives here or in layout) | `apps/web/components/NotificationBell.tsx` (only if you add the mobile menu button beside it) |
| Root layout — viewport meta, body overflow-x guard | `apps/web/app/layout.tsx` (imports `@/styles/theme.css`) |
| Breakpoint tokens / global overflow guards | `apps/web/styles/theme.css` (Tailwind v4 `@theme`) |
| **Reusable primitives (NEW)** | new files under `apps/web/components/ui/` — a `useBreakpoint`/`useMediaQuery` hook, an optional `PageContainer`, and a nav-collapse context/provider |
| Responsive table primitive (ENHANCE, additive only) | `apps/web/components/ui/Table.tsx` — see §0.2 rule 2 |

### 0.2 Scope discipline (keep pass 1 focused)
1. **Do NOT modify any file under `apps/web/app/(app)/**/page.tsx`, any page-level component, `apps/web/lib/data/*`, `apps/web/app/api/*`, `apps/worker/*`, `packages/shared/src/constants/permissions.ts`, or any migration.** This is the FOUNDATION pass — it changes no behavior, routes, or data. If a page looks like it needs responsive work, that's **pass 2 — leave it**.
2. **`components/ui/Table.tsx` is imported by many pages.** You MAY enhance it to be responsive, but ONLY **additively / backward-compatibly** — wrap its content in an `overflow-x-auto` container, add OPTIONAL props; never change or remove an existing prop or its default rendering (pass 2 will lean on it). If responsiveness would need a breaking change, build a NEW wrapper primitive and leave `Table.tsx` alone.
3. **Scope every commit to explicit paths — never `git add -A`.** Commit only your §0.1 files.
4. **Leave all untracked files alone** (other briefs in `docs/plan/`, `docs/roadmap.html`, `.claude/`).
5. Before you start, run `git branch --show-current` + `git status`. If another build session is active in this shared checkout, prefer a separate worktree and don't run `pnpm --filter web build` at the same instant (shared `.next`).

---

## 1. Build (pass 1)

**1.1 Collapsible + sticky main nav** (`Sidebar.tsx`) — three states:
- **Expanded** (current: `w-60`, full labels + icons) — the default on wide screens.
- **Collapsed** (icon-only rail, ~`w-16`): labels hidden, icons centered, tooltips on hover for the label; the bottom user section collapses to just the avatar. A **toggle button on the sidebar's RIGHT edge** flips expanded ⇄ collapsed. **Persist the state in `localStorage`** (follow the pattern in `components/ui/CollapsibleSection.tsx`).
- **Mobile off-canvas** (below a breakpoint, e.g. `< md`): the sidebar is hidden by default and slides in as a drawer over the content with a dimmed scrim; a **hamburger button in the top bar** opens it; the scrim (and selecting a nav item) closes it. Use a nav-collapse **context/provider** so the layout's hamburger and the Sidebar share open/closed state.
- Keep the existing role-filtering (`useAuth().can`), active-item highlighting, the user section (avatar/role/calendar dot/Sign Out), and the navy styling intact. Accessibility: the toggle + hamburger are real `<button>`s with `aria-expanded`/`aria-label`; the drawer traps nothing but closes on `Esc`.

**1.2 App-shell consistency** (`app/(app)/layout.tsx`):
- Make **`<main>` the single vertical scroll container** and the header **sticky** at the top of the content column (it currently is `h-14` but confirm it stays put while `<main>` scrolls). The page/body must **never scroll horizontally** — add an `overflow-x` guard so wide content scrolls *inside its own container*, not the shell.
- Add the **hamburger** (mobile only) to the header, wired to the nav-collapse context.
- Ensure the shell works from ~320px up to wide desktop: sidebar (or drawer) + content, no overlap, no horizontal body scroll.
- The root `app/layout.tsx` should have a correct **viewport meta** (`width=device-width, initial-scale=1`) — add it if missing — and the body an `overflow-x-hidden` / min-width-0 guard.

**1.3 Reusable responsive primitives** (new, in `components/ui/`) — build + document them; **do NOT retrofit existing pages with them** (pass 2):
- `useBreakpoint()` / `useMediaQuery(query)` hook (SSR-safe: no hydration mismatch — default to a sensible server value).
- Optional `PageContainer` — a consistent max-width + responsive padding wrapper that pass 2 will drop into each page.
- The responsive `Table` enhancement per §0.2 rule 2 (the pattern pass 2 applies to every data table).
- Export them from wherever `components/ui/*` is conventionally imported.

## 2. Non-goals (these are PASS 2 — after P9 merges; do NOT do them here)
- Retrofitting individual pages for responsiveness (dashboard, clients, calendar, contacts, documents, assistant, settings, pipeline, etc.) — including making their tables/grids reflow and dropping in `PageContainer`. That sweep runs after P9 so it also covers P9's new Settings/Pipeline pages.
- The heavy `calendar/page.tsx` responsive rework (it's ~1.5k lines and is a P9-adjacent file — leave it entirely).
- Any data/route/worker/permission change.

## 3. Verify (use the preview tools, not guesswork)
- Run the dev server and **screenshot the shell at three widths** — mobile (375), tablet (768), desktop (1280): nav expanded, nav collapsed (rail), and mobile drawer open + closed. Confirm no horizontal body scroll at any width and the header stays sticky while content scrolls.
- Toggle collapse, reload, confirm the state persisted. Open/close the mobile drawer via hamburger + scrim + Esc + selecting an item.
- Confirm role-filtered nav items + the user section still render in all three states.

## 4. Gate + PR
- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`. (If the build's only failure is the pre-existing `/daily-sync` static-prerender needing the LAN DB, note it — it's environmental.)
- **No secrets staged**; commits scoped to §0.1 files only (`git diff --cached --name-only` should show nothing outside §0.1).
- **PR notes:** the three nav states + how state is shared/persisted; every file touched (must be a subset of §0.1); confirm `Table.tsx` change (if any) is additive/backward-compatible; confirm you did NOT touch any P9/pass-2 file; the three-width screenshots.
- Branch name suggestion: `feat/rl-responsive-foundation`. **Branch + PR — do NOT push to main.**
