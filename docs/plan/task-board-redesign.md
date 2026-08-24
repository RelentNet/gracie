# Task Board redesign — per-client, last-meeting view (Allie's Aug-21 vision)

**Branch:** `feat/task-board-redesign`
**Scope:** a VIEW rework of the existing admin Task Board (`apps/web/app/(app)/tasks/page.tsx`).
No changes to the task lifecycle, permissions model, or bulk endpoints — this builds ON
#106 (aging/archive), #122 (visibility toggle), and #123 (bulk merge/delete), all kept intact.

## The problem

The old board was one cross-client grid of every task, filtered by client / owner / status /
priority / due-date. Allie called it "a nightmare": too much at once, organised around owner and
due-date (which GA doesn't run on). She wants to look at **one client, one meeting** — "the top
items from the last meeting" — and move on.

## The redesign (what shipped)

1. **Two dropdowns drive it.**
   - **Client** — pick a client → only that client's tasks. This is the primary view; there is
     **no all-clients firehose** anymore (see Decisions). Auto-selects the client you last met
     with when the page opens, so it's never empty.
   - **Meeting** — the client's meeting **dates**, newest first; **defaults to the most recent
     meeting**. Pick an earlier date to look back. A trailing "Other tasks (no meeting)" entry
     holds manual / document-sourced tasks so nothing is unreachable.
2. **Minimal columns.** Owner and due-date are **gone**. Columns are now: the **task**, its
   **priority** (HIGH / standard), and the source **meeting date** (in place of due-date). The
   redundant Client column is dropped (the client is the dropdown). Admins keep the leading
   select checkbox; everyone keeps the notes expander.
3. **Color-coding.** Completed tasks read **green** — a green row tone plus a "Done" badge (not
   colour alone, for accessibility). Open / in-progress stay neutral.
4. **Ephemeral / cache.** No new aging logic — #106 already archives stale standard tasks after
   two weeks and keeps HIGH ones. "Show archived" surfaces that per-client **cache**; the default
   stays current tasks.
5. **Admin-gated + #122 honored exactly.** `canSeeTaskBoard(can('task.manageBoard'),
   taskBoardVisibleToAll)` still gates the page (identical to the nav item + list/export APIs);
   the placeholder path is unchanged. Bulk actions still gate on `task.manageBoard`.

## How the meeting date is sourced (no migration)

Tasks **already** carry `source_meeting_id` with a real FK to `meetings`
(`tasks_source_meeting_id_fkey`), and the worker has always populated it when it generates a
meeting's tasks (`apps/worker/src/processors/generate.processor.ts`). So there was **nothing to
add or backfill** — the link exists.

The only gap was that the board's list query didn't fetch the linked meeting's date. Added a
dedicated data function that embeds it:

- `apps/web/lib/data/tasks.ts` → **`listTasksForBoard()`** selects
  `*, source_meeting:meetings!tasks_source_meeting_id_fkey(date_time)` and maps it onto a new
  optional `Task.sourceMeetingAt` field. `GET /api/tasks` now uses it. `listTasks` is left
  untouched for its other two callers (CSV export, the Assistant), so nothing else changed.
- `packages/shared/src/types/task.ts` → `Task.sourceMeetingAt?: ISOTimestamp | null` (optional; only
  the board query populates it — every other Task producer leaves it undefined).

## Pure view logic (unit-tested)

`apps/web/lib/tasks-board.ts` — no React, no data access:

- `localDateKey(iso, zone?)` — device-local `YYYY-MM-DD` (en-CA, ISO-order) for grouping/sorting.
- `groupTasksByMeetingDate(tasks, zone?)` — buckets a client's tasks by source-meeting date,
  newest first, "no meeting" bucket last.
- `mostRecentMeetingKey(groups)` — the default meeting selection.
- `clientWithLatestMeeting(tasks)` — the default client selection.
- `taskColor(task)` — `complete` (green) vs `neutral`.

Tests: `apps/web/lib/tasks-board.test.ts` (6 tests, `node:test`) — grouping order, same-day
bucketing + representative timestamp, no-meeting bucket, most-recent selection, latest-client
selection, colour state. All pass (83/83 web suite).

## Shared primitive touched

`components/ui/Table.tsx` — added a `success` row tone (`--color-emerald-100`) for completed rows.
Additive; existing `default | critical | warning` tones unchanged.

## Decisions / flags

- **All-clients firehose removed.** The board is per-client only — that's the whole point of the
  redesign. Admins who want the cross-client dump still have **Download CSV** (unchanged) and the
  Assistant. If a cross-client overview is later wanted back, it'd be an explicit "All clients"
  option, not the default.
- **No migration, no backfill.** The meeting link + FK already exist and are populated going
  forward. Tasks with no source meeting (manual tasks, document-sourced tasks, and any legacy row
  that predates population) land in the **"Other tasks (no meeting)"** bucket — reachable, just not
  under a meeting date. This is the graceful-degrade path the brief asked for, not a limitation to
  fix.
- **Grouping is by meeting DATE, not meeting id.** If a client had two meetings on the same day,
  their tasks share one date bucket. Typical GA cadence is ≤1 meeting/client/day, so this keeps the
  dropdown simple. Per-meeting granularity can be added later if it ever matters.
- **CSV export left as-is.** It still exports the full cross-client set with the old columns
  (owner/due/status). Out of scope for the on-screen redesign; still a valid admin artifact.

## Verification

- `pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ · `pnpm --filter web test` ✅ (83/83).
- Live preview not run: the authenticated `/tasks` route needs Logto SSO, and this dev
  `.env.local` carries no Logto credentials (Supabase reachable, auth wall not passable headless).
  The change is presentational + pure-logic, covered by the gate and the new unit tests; the
  Supabase embed is type-checked against the generated relationship types.
