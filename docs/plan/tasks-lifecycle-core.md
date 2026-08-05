# Tasks lifecycle core

GA has tried task-tracking 3–4× in 15 years and it never stuck. The team judges
tasks on how reliably they **clear**, not how many get captured. This PR reworks the
task lifecycle so the list stays short and self-clearing, and kills the 200+ duplicate
pile at the source.

Task **creation** happens in the worker generation pipeline
(`apps/worker/src/processors/generate.processor.ts`). That is where the lifecycle rules
below are applied; the pure logic lives in `apps/worker/src/lib/task-lifecycle.ts` and is
unit-tested (`task-lifecycle.test.ts`).

## No migration
The existing `tasks.priority_flag boolean` already models exactly two priorities
(true = high, false = standard), and `tasks.updated_at` is the activity signal aging
needs. Dedup queries existing rows. So this PR ships **no schema change** — additive or
otherwise. Nothing to apply to prod.

## What changed

1. **Board is admin-only.** New admin-only permission `task.manageBoard`. The `/tasks`
   nav item is hidden for non-admins, the page renders an "Administrators only"
   placeholder for them, and `GET /api/tasks` (the cross-client list) is gated to admins.
   Regular users manage tasks per-client via each client's Tasks panel — never a global
   list they must curate.

2. **Two priorities only: `standard` | `high`.** Reuses `priority_flag`. Default
   standard. `high` = explicitly flagged important by extraction, OR escalated on a
   repeat (see 4). Display renamed MEDIUM → STANDARD (`priorityBadge`).

3. **Owner assigned only when a name is clearly present.** `resolveTaskOwner` matches on
   exact full name / email / email local-part / a name token ("Sarah" → "Sarah Chen").
   The old loose substring fallback (which could mis-assign) is gone. No name → the task
   lives under the client, unassigned.

4. **Dedup is the keystone.** Before creating any pipeline task we check the client
   doesn't already have the same one — fuzzy match (token-overlap coefficient ≥ 0.8 over
   stopword-stripped signatures) against the client's **active OR archived** tasks
   (completed tasks are excluded, so a re-mention of finished work is legitimately new).
   On a match we never duplicate:
   - archived match → **reactivate as high** (it came back = it matters again),
   - active match → **escalate to high** (re-mentioned while open = a repeat).
   This is what makes "repeat → High" work and stops the pile.

5. **Aging.** A nightly worker sweep (`task-aging.processor.ts`, new `task-aging` queue)
   archives standard tasks with no activity for ~2 weeks (`STANDARD_TASK_TTL_DAYS = 14`).
   High tasks persist until done. Archive is a status, never a delete — everything stays
   recoverable and a repeat mention reactivates it.

6. **Archive vs delete split.** Regular users only Archive (recoverable) — already true
   on the per-client panel. Admins get a real, permanent hard delete: new admin-only
   `DELETE /api/tasks/:taskId`, wired to the board's "Delete permanently" action. This is
   the escape hatch for clearing existing duplicate/junk tasks.

7. **~3 active tasks per client cap.** `MAX_ACTIVE_TASKS_PER_CLIENT = 3`. When applying a
   meeting's tasks pushes a client over the cap, the stalest **standard** tasks are
   archived down to the cap (`decideCapEvictions`); high tasks are never auto-evicted, so
   a client saturated with high tasks may legitimately stay above the cap.

## Operability
Every stuck/stale state resolves in-app with one obvious control: archived tasks are
found + restored via "Show archived"; the aging + cap sweeps self-heal without a console;
the aging sweep is visible in Bull Board and logs what it archived; hard-delete is a
deliberate, confirmed admin action. No SQL, script, or log-reading needed.

## Tests
`apps/worker/src/lib/task-lifecycle.test.ts` covers normalization, fuzzy dedup
(identical / restated / distinct / all-stopword fallback), the insert/escalate/reactivate
decision, the per-client cap (stalest-standard eviction, high protection, no-op under
cap), owner-on-name (and NOT on loose substring), and the aging cutoff.

## Deferred to follow-on PRs (not built here)
CSV export; closing tasks from the daily-sync transcript; assistant-driven task Q&A
("Gracie, what were last week's tasks?"); a consolidation prompt; a per-meeting-record
summary linking to the canonical task. Dedup is scoped to the generation pipeline;
manual task creation (the client panel "Add task") is a deliberate human act and is left
un-deduped by design.
