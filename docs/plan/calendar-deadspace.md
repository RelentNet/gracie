# Calendar — reclaim the dead space

**Branch:** `feat/calendar-deadspace` · **Scope:** presentational only (no data
fetching, org-link, or create-client logic changed). From the Aug 11 review:
kill the calendar page's dead space.

## What changed

`apps/web/app/(app)/calendar/page.tsx` (+ three of its components). Targeted
layout edits, no rewrite.

### 1. Combined cadence / needs-client bar (one bar, split in two, at the bottom)
The two previously-stacked full-width cards — **"N meetings need a client"**
(`AmbiguousSection`, admin-only) and **"Cadence tracker"** (`CadenceSection`) —
now sit **side by side** in one row at the bottom of the page:

```
<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
  {isAdmin ? <AmbiguousSection … /> : null}
  <CadenceSection />
</div>
```

Each section's root `Card` gained `lg:flex-1`, so:
- both present → two equal halves;
- either absent (non-admin, or `AmbiguousSection` returning `null` when nothing
  needs a client) → the remaining half fills the full width (no new dead half).
- `lg:items-start` keeps the two halves independently sized (an expanded cadence
  table doesn't stretch the short needs-client card).

Stacks full-width on mobile.

### 2. Wider + longer mains
- Grid went `lg:grid-cols-4` → **`lg:grid-cols-3`**: the day agenda widens from
  1/4 → **1/3**; the calendar stays the dominant main at **2/3** (`col-span-3` →
  `col-span-2`).
- The agenda is now **lengthened to the calendar's full height** (see #3),
  replacing the tall empty gap that used to sit beside a short agenda card.

### 3. Day agenda equalizes height with the calendar and scrolls within itself
Pure-CSS height cap, no JS, no fixed pixel height:

- The agenda column is `lg:relative lg:col-span-1` and its content sits in an
  inner `flex flex-col lg:absolute lg:inset-0` layer. Because the absolute layer
  contributes **zero** intrinsic height, the **calendar column alone sizes the
  grid row** — so the agenda is always capped to exactly the calendar's height,
  regardless of how many meetings the day has.
- `DayDetail`'s `Card` became `flex min-h-0 flex-1 flex-col` (fills that height),
  and its meeting list moved into a `min-h-0 flex-1 overflow-y-auto` region under
  the fixed header. Result: **~3 meetings at a time, scroll for more**, bounded to
  the calendar's height.
- On mobile (`< lg`) the `lg:`-gated absolute positioning is off, so the agenda
  stacks above the calendar and flows the full list naturally (no cramped inner
  scroll on a phone).

## Files
- `apps/web/app/(app)/calendar/page.tsx` — grid ratio, agenda wrapper, combined bar.
- `apps/web/app/(app)/calendar/components/DayDetail.tsx` — full-height card + inner scroll region.
- `apps/web/app/(app)/calendar/components/CadenceSection.tsx` — `lg:flex-1` on root card.
- `apps/web/app/(app)/calendar/components/AmbiguousSection.tsx` — `lg:flex-1` on both root cards.

All four components are calendar-only (grep-confirmed), so the changes don't
touch any other page.

## Verification
- `pnpm -r typecheck` — green (5/5 projects).
- `pnpm -r lint` — green (5/5 projects).
- The authenticated `/calendar` page couldn't be previewed in this environment
  (Logto auth + NAT-gated backend). The core CSS mechanic (absolute-inset-0
  height cap → agenda equals calendar height → inner list scrolls, showing ~3
  items; combined bottom bar splitting in two) was validated in a standalone
  static HTML mock rendered in the browser pane using the identical layout
  classes. Recommend a quick live look after deploy.

## Notes / known ceilings
- In **Week** view the calendar grid is short (one Mon–Fri row), so the agenda —
  which matches the calendar's height by design — is correspondingly short there.
  Acceptable: week view also lists each day's meetings in its own columns, and the
  reviewed dead space was the Month view. `ponytail:` if a taller week agenda is
  wanted later, give the week grid a taller `min-h` or floor the agenda scroll
  region with a `lg:min-h`.
