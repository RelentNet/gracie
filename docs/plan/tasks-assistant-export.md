# Tasks via the Assistant + CSV export

**Branch:** `feat/tasks-assistant-and-export` · **Status:** PR open, not merged

## Why

PR #106 made the cross-client **Task Board admin-only** (`task.manageBoard`;
`GET /api/tasks` now 403s non-admins). Regular staff therefore need another way to
reach tasks, and Allie asked for a spreadsheet of the board. Two follow-ons:

1. **Assistant task Q&A** — any staffer can ask the assistant about tasks and get a
   direct answer ("what's open for me?", "which of Cotiviti's tasks are done?",
   "what came up last week?").
2. **CSV export** of the Task Board for admins.

## What shipped

### 1. Assistant task Q&A — extended the existing `list_tasks` tool

The company-aware assistant already had a read-only `list_tasks` tool
(`apps/web/lib/assistant/company/tools.ts`) filtering by status / overdue / client.
Rather than add a second, overlapping tool, it was **extended** with the two missing
filters the brief called for:

- `owner` — `"me"` (the asking user, from the fixed turn identity — never a name from
  the model), a teammate's name/initials/id, or `"unassigned"`.
- `recentDays` — tasks **created or updated** within the last N days (e.g. 7 = "last
  week").

Each row now also carries the **owner name**. The tool description tells the model to
answer directly from the rows (a short open/done/overdue summary) rather than link to
the admin-only board, and reaffirms all-see-all (any staff may ask about any client).
The system prompt already lists `list_tasks`, so no prompt change was needed.

All filtering now routes through one **pure, tested** function,
`filterTasks(tasks, filter, now)`, in `apps/web/lib/data/tasks-report.ts`.

### 2. CSV export

- `GET /api/tasks/export` (`?archived=true` includes archived) — **admin-only**,
  matching the board's `task.manageBoard` gate and `GET /api/tasks`. Returns
  `text/csv` with an RFC-6266 attachment header (`attachmentDisposition`), filename
  `tasks-YYYY-MM-DD.csv`. Columns: **Client, Description, Owner, Priority, Status,
  Created, Updated, Due date**. Client/owner ids are resolved to names in the route;
  the shaping is the pure `tasksToCsv(tasks, clientNames, ownerNames)`.
- **"Download CSV"** button on the Task Board (`app/(app)/tasks/page.tsx`) — a
  cookie-authenticated `<a href download>` styled like the contacts export button;
  its href follows the "Show archived" toggle. The page is already admin-gated, so the
  button only renders for admins.

## Tests

`apps/web/lib/data/tasks-report.test.ts` (node:test, run via `pnpm --filter web test`)
covers `filterTasks` (status, overdue edge cases, client, owner-by-id vs unassigned,
recency via created-or-updated, combined AND) and `tasksToCsv` (header contract, name/
priority/status/date resolution, Internal/Unassigned/Unknown fallbacks, RFC-4180
escaping).

## Notes / ceilings

- **recency** matches on `max(createdAt, updatedAt)` within the window — one forgiving
  predicate that covers "came up" and "was worked on". Not a `dueDate`-range filter.
- CSV cell escaping is a local 3-line RFC-4180 helper (a near-duplicate of the private
  one in `lib/data/contacts.ts`). Left duplicated to keep the diff additive; a shared
  `lib/csv.ts` is the obvious upgrade if a third exporter appears.
- Export mirrors the board's active-by-default / `?archived=true` behaviour.

## Gate

`pnpm -r typecheck` ✓ · `pnpm -r lint` ✓ · `pnpm --filter web test` ✓ (66 pass).
