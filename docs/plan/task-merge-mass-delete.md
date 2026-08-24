# Task Board — bulk-select: Merge + Mass-delete

**Branch:** `feat/task-merge-mass-delete` · **Scope:** admin Task Board (`apps/web/app/(app)/tasks/page.tsx`)

## Why

The admin Task Board (#106) had only per-row actions. With 190+ live tasks it needs a way to
clear the board fast and to collapse duplicate/related tasks into one. This adds bulk multi-select
with two bulk actions — **Mass-delete** and **Merge** — both admin-only, both confirm before acting.

## What shipped

1. **Multi-select** — a checkbox on every task row plus a header "select all (in the current filter)"
   checkbox (with an indeterminate some-selected state). A selection toolbar appears when ≥1 row is
   selected showing the count and the two bulk actions, plus a "Clear". Selection is always
   intersected with the *visible* filtered rows, so an action can never touch a task that scrolled
   out of the current filter. Checkbox column + toolbar render only for editors (the board is
   already admin-only, so this is effectively admin-gated).

2. **Mass-delete** — "Delete selected" → confirm ("Permanently delete N tasks? This can't be undone.")
   → one hard-delete call. New endpoint `POST /api/tasks/bulk-delete { ids }` (admin-only, capped at
   1000/call) → `deleteTasks(ids)` does a single `.in('id', ids)` delete (`task_notes` cascade via FK).
   Archive stays the recoverable path; this is the permanent one.

3. **Merge** — enabled at 2+ selected. "Merge" → confirm modal lists the tasks with the first-selected
   clearly marked **"Primary — kept"** and the rest **"Merged in"** → combine into the primary:
   - the primary's **description** with each distinct merged-away description folded in on a bullet line,
   - the **highest priority** among them (any high → high),
   - the primary's **client** unchanged,
   - the merged-away tasks' **notes re-parented** onto the primary (history preserved), then those tasks deleted.

   New endpoint `POST /api/tasks/merge { primaryId, mergedIds }` (admin-only) → `mergeTasks()` in the data
   layer. If the selection spans multiple clients the Merge button stays clickable but the modal shows a
   plain block message ("Merge only works within one client — deselect tasks until only one client
   remains") with just a Close button — a task is client-scoped. (Chose a visible in-modal message over a
   silently-disabled button, per the non-technical-operable rule.)

4. Both actions confirm first and refresh the board in place from the response (no full reload).

## Where the code lives

- **Pure combine logic (unit-tested):** `packages/shared/src/tasks/lifecycle.ts`
  - `combineMergedTasks(tasks)` → `{ description, priorityFlag }` (survivor = `tasks[0]`; folds in distinct
    merged-away descriptions via `normalizeDescription` dedup; max priority). Dedup is deliberately
    conservative (exact restatement only) so real content is never lost.
  - `tasksShareClient(tasks)` → same-client guard.
- **Data layer:** `apps/web/lib/data/tasks.ts` — `deleteTasks(ids)`, `mergeTasks(primaryId, mergedIds)`
  (reuses `combineMergedTasks` + `tasksShareClient` + the existing `updateTask`).
- **Endpoints:** `apps/web/app/api/tasks/bulk-delete/route.ts`, `apps/web/app/api/tasks/merge/route.ts`.
- **UI:** `apps/web/app/(app)/tasks/page.tsx` — selection state, toolbar, checkbox column, confirm modals.
- **Tests:** `apps/web/lib/task-merge.test.ts` (combine + guard; runs under `pnpm --filter web test`).

## No migration

Additive only — reuses the existing `tasks` hard-delete path and `task_notes` re-parent. No schema change.

## ponytail notes (deliberate shortcuts)

- `mergeTasks` runs reparent → update → delete in sequence, not one transaction. A mid-way failure
  surfaces as an error and leaves rows partially moved — acceptable for rare admin cleanup; wrap in an
  RPC if it ever matters.
- No health recompute on bulk-delete/merge — mirrors the existing single hard-delete decision (the
  nightly relationship-health sweep is the backstop).

## Verification

- `pnpm -r typecheck` ✓ · `pnpm -r lint` ✓ · `pnpm --filter web test` → 72/72 ✓.
- Live against the LAN backend (dev server, mock-admin): checkbox column + select-all, toolbar
  ("N selected · Merge · Delete selected · Clear"), same-client merge modal (Primary/Merged labels),
  multi-client block message, and delete confirm all verified. A create → merge → bulk-delete → cleanup
  round-trip against the real API confirmed the combined description, max-priority survivor, unchanged
  client, deleted merged task, and `{ok, deleted:2}` — with zero leftover test rows (DB restored). No
  existing tasks were mutated.
