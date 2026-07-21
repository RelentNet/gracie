# Delegation Brief — RL (pass 2): Per-Page Responsive Sweep

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §1 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Next.js app-router web in `apps/web`. **Tailwind v4** (`apps/web/styles/theme.css`).
> **Depends on RL pass 1 (merged, `e8f0bf3`)** — the responsive shell, collapsible/sticky nav, and primitives already exist. This pass APPLIES them page-by-page.
> **Presentational only — no behavior/route/data change.** **Branch + PR for review. Do NOT push to `main`.**

---

## 0. What this is
RL pass 1 built the responsive **foundation** (shell + nav + primitives). Pass 2 makes **every page's content** reflow cleanly on mobile/tablet using those primitives. You are changing layout/CSS/markup only — never data fetching, routes, permissions, or business logic.

**Use the pass-1 primitives (already in the repo):**
- `components/ui/PageContainer.tsx` — consistent max-width + responsive padding wrapper. Wrap each page's content in it.
- `components/ui/useMediaQuery.ts` — SSR-safe `useMediaQuery` / `useBreakpoint(bp)` + `BREAKPOINTS`. Use for JS layout decisions (e.g. render a card list vs. a table) that CSS can't express. Prefer CSS `md:`/`lg:` utilities for pure structure to avoid a desktop flash.
- `components/ui/Table.tsx` — now takes optional `minWidth` + `scrollRegionLabel`. For any data-dense table, set both so it scrolls horizontally (labelled, keyboard-focusable) instead of squashing.
- The shell already gives you a single scroll container, sticky header, and a no-horizontal-body-scroll guarantee — don't fight it (no page-level `h-dvh`/`overflow` hacks; wide content scrolls inside its OWN container).

## 1. The patterns to apply (consistently, everywhere)
- **Page wrapper:** wrap top-level page content in `<PageContainer>`; drop ad-hoc `max-w`/`p-8` where it duplicates the container.
- **Tables:** use `Table` with `minWidth` + `scrollRegionLabel`. For the most cramped tables, optionally reflow to a stacked card list below `md` (via `useBreakpoint('md')` or a `md:hidden`/`hidden md:block` pair) — judgement call per table; horizontal-scroll is the acceptable minimum.
- **Card grids / stat rows:** `grid-cols-1` on mobile → `sm:/md:/lg:grid-cols-*` up. No fixed multi-column that overflows.
- **Client-detail sub-tab bar** (`clients/[clientId]/layout.tsx`): make the tab row horizontally scrollable (`overflow-x-auto`, no wrap) or reflow on narrow screens — it must not overflow the viewport.
- **Forms / editors** (settings panels, `FinanceEditor`, modals): stack fields to one column on mobile; inputs `w-full`; buttons wrap.
- **Modals / drawers** (`components/ui/Modal`, `ContactProfileDrawer`, `DriveBrowser` aside): full-width / bottom-sheet-ish on mobile; the `DriveBrowser` folder aside should collapse or stack under the file list below `md`.
- **Long headers / toolbars:** allow wrap; avoid fixed-width rows.
- **Touch targets:** interactive controls ≥ ~40px hit area on mobile.

## 2. Page inventory (the checklist — nothing gets skipped)
**Group A — lists & overviews (start here; straightforward):**
`dashboard` · `clients` (list) · `contacts` · `documents` · `knowledge-base` (table) · `tasks` (table) · `daily-sync` · `pipeline` (table + the P9 error-log) · `upload` · `assistant` (chat: composer + message column + conversation list drawer on mobile) · `automations`

**Group B — client detail:** `clients/[clientId]/layout.tsx` (the sub-tab bar) + the 7 tabs: `overview` · `intelligence` (chat) · `operations` (table) · `notes` · `finance` (`FinanceEditor`) · `documents` · `strategy`

**Group C — settings:** `settings` page + its panels (Users / Meeting Bot / Notifications / Automations / API Settings / Company / Scoring / AI-Model) — forms stack on mobile.

**Group D — calendar (SEPARATE, do LAST):** `calendar/page.tsx` is ~1.5k lines (month grid + day detail + connection/org-link/create-org/domains modals). Make it responsive with **minimal structural change** — the month grid scrolls/reflows, the day-detail + modals stack on mobile. **Do NOT do the big component-split refactor here** (that's a separate tracked cleanup follow-up); if responsiveness genuinely requires touching logic, stop and flag it rather than refactoring.

## 3. PR strategy (keep it reviewable)
This is a large sweep — **split it into multiple PRs by group** (A, then B, then C, then D-calendar on its own). Each PR: green-gates independently, is preview-verified, and is presentational-only. A reviewer should be able to read one group at a time. (If dispatched as one session, produce the groups as separate PRs; the calendar MUST be its own PR.)

## 4. Scope guardrails
- You MAY edit `app/(app)/**/page.tsx`, page-level components under `components/`, and `clients/[clientId]/layout.tsx` — but ONLY for layout/responsiveness.
- **Do NOT change** data fetching, `lib/data/*`, `api/*` routes, `apps/worker/*`, `permissions.ts`, migrations, or any business logic. No new deps.
- **Do NOT re-touch** the pass-1 foundation files (`Sidebar.tsx`, `(app)/layout.tsx`, root `layout.tsx`, `theme.css`, the new primitives) except to *use* the primitives. If a primitive needs a real enhancement, keep it additive/backward-compatible and call it out.
- Scope commits to explicit paths (never `git add -A`). Leave untracked files (`docs/plan/*`, `docs/roadmap.html`, `.claude/`) alone. Before starting: `git branch --show-current` + `git status`; base off `origin/main`. If another session shares the checkout, don't run `pnpm --filter web build` while its `next dev` is live (shared `.next`).

## 5. Verify (preview tools — every group)
For each page in the group, screenshot at **375 / 768 / 1280** and confirm: no horizontal body scroll; content reflows (tables scroll/stack, grids collapse to 1 col, forms stack); the sub-tab bar + toolbars don't overflow; modals/drawers usable on mobile; nothing clipped/overlapping; no console errors. Spot-check that behavior is unchanged (a table still sorts, a form still saves) — you changed layout, not logic.

## 6. Gate + PR
- **Green gate per PR:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`.
- **PR notes:** which group/pages; the before/after at mobile width (screenshots); confirm presentational-only (no data/route/logic change); confirm no pass-1 foundation regression.
- Branch names like `feat/rl-sweep-<group>`. **Branch + PR — do NOT push to main.**

START: pick Group A, read those pages + the pass-1 primitives (`PageContainer`, `useMediaQuery`, the updated `Table`), confirm your plan for the group, then apply the patterns and preview-verify before opening the PR.
