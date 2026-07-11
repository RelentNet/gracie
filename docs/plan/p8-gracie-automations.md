# Delegation Brief — P8: Gracie Automations (native, agentic)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §2 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. **This is the largest phase to date and makes Gracie AGENTIC** — the Assistant gains its first *actions*. **§2 (confirm-before-acting + the customer-exception) is the safety core — build it first and never weaken it.**
> **Branch + PR for review. Do NOT push to `main`.** Build in the order in §1.1; a partial-but-safe PR is better than a complete-but-unsafe one.

---

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` / `docs/09-build-phases.md` — product state. **P8 was re-scoped:** it is NOT the n8n integration (that's parked → Gracie v2.0, `docs/plan/p8-n8n-automations.md`). P8 is a **native, Gracie-owned automation engine** that non-technical users create by asking the AI **Assistant** in chat.
- The safety posture you're extending: P6B.1 made the Assistant **strictly read-only**; P7 made email a **single allowlist-gated choke-point** (`@graceandassociates.com` only). P8 deliberately opens *both*, but only behind explicit-user-request + confirmation + audit + admin gate.

### 0.1 Where to touch (mapped by the orchestrator — trust, then verify)
| Concern | File(s) |
|---|---|
| Worker cron/queue contract | `packages/shared/src/constants/queues.ts` (QUEUE_NAMES/JOB_NAMES/JOB_SCHEDULER_IDS/interval) |
| Queue/worker factory + wiring | `apps/worker/src/queues/factory.ts`; new `apps/worker/src/queues/automations.queue.ts`; wire in `apps/worker/src/index.ts` |
| **Sweep pattern to copy** | `apps/worker/src/processors/daily-sync.processor.ts` (ET wall-clock gate `easternHour`, config read, `source:'manual'` bypass) + `relationship-health.processor.ts` (one queue, sweep-vs-single via payload) |
| Assistant tool contract | `packages/shared/src/ai/provider.ts` (`AITool`/`AIToolCall`/`AIMessage`, `GenerateInput.tools/toolChoice`) + `openai.adapter.ts` |
| Assistant tools registry (read-only today) | `apps/web/lib/assistant/company/tools.ts` (`CompanyTool`, `executeCompanyTool`, `COMPANY_TOOLS`) |
| Two-phase tool loop | `apps/web/lib/ai/tool-loop.ts` (`resolveTools`) |
| Chat route (two-phase stream) | `apps/web/app/api/assistant/chat/route.ts` |
| System prompt (says "READ-ONLY") | `apps/web/lib/assistant/prompt.ts` (`buildAssistantSystemPrompt`) |
| Message persistence (constraint!) | `apps/web/lib/data/assistant.ts` (`insertMessage` — only `user`/`assistant` rows) |
| Chat UI (confirm card renders here) | `apps/web/components/chat/{ChatThread,ChatBubble,ChatComposer,types}.tsx`; `apps/web/app/(app)/assistant/page.tsx` (`send()`) |
| **Send choke-point** | `apps/worker/src/lib/resend.ts` (`sendEmail`, `filterAllowedRecipients`, `loadAllowedDomains`, `SendEmailDeps.allowedDomains`) + `apps/worker/src/lib/email.ts` (`sendTeamEmail`) |
| Reusable report/digest actions | daily-sync `gatherYesterday/gatherTodayMeetings/gatherAtRisk`; `apps/worker/src/lib/brief.ts` (`buildBriefContent`); `apps/web/lib/data/client-detail.ts` + `calendar.ts`; `packages/db/src/ai.ts` (`getActiveProvider`) |
| Notifications delivery | `notifications` table + `apps/web/components/NotificationBell.tsx` |
| Permissions | `packages/shared/src/constants/permissions.ts` + `apps/web/lib/api-auth.ts` |
| Nav + page + web→worker enqueue | `apps/web/lib/navigation.ts`; `apps/web/app/(app)/automations/page.tsx` (new); `apps/web/lib/queue.ts` |
| Migration + types | `packages/db/migrations/` (latest `0008`; add **`0009`**); regen `packages/db/src/database.types.ts` (`supabase gen types`); hand types `packages/shared/src/types/automation.ts`; enums `packages/shared/src/constants/enums.ts` |

### 1. Locked decisions (operator)
Native engine · **agentic Assistant with confirmed actions** · **customer-contact exception** (internal by default; external only when explicitly user-initiated + confirmed + logged + admin-enabled) · **management GUI** (list + last-run + delete/pause/run-now; user sees own, admin sees all) · **graceful capability boundary** (out-of-catalog → an admin "advanced requests" inbox). n8n stays deferred (v2.0).

### 1.1 Build order (each step green-gates independently)
1. **Data model `0009`** (§3) + types/enums.
2. **Worker engine** (§4): the due-sweep processor + the v1 **action executors**, testable by inserting an `automations` row directly and watching it run + log.
3. **GUI** (§6): the Automations page (list/last-run/delete/pause/run-now) + admin advanced-requests inbox — manage rows even before chat can create them.
4. **Agentic Assistant** (§5): the propose→confirm→execute flow (the hard part).
5. **Customer-exception** (§2) wired end-to-end + audited.

---

## 2. SAFETY CORE (non-negotiable)

**a) Confirm-before-acting.** The Assistant may *propose* actions but must NEVER execute one inside the chat stream. Flow: the `create_automation` tool VALIDATES + PERSISTS a **`pending_confirmation`** automation and returns a proposal; the chat renders a **confirm card**; a deliberate **Confirm click → a SEPARATE, permission-gated, server route** activates/runs it (re-validating server-side). The LLM never activates or sends. *(This is forced by the architecture anyway — see §5's persistence constraint.)*

**b) Customer-contact exception.** Default = internal-only (the P7 choke-point stands). An automation may email an **external** recipient ONLY when ALL hold: (1) it was explicitly user-initiated, (2) the admin master switch `automations_external_send_enabled` is ON (settings row, **default OFF**), (3) the confirming user passes an extra explicit confirmation, (4) **every external send is written to `automation_runs.external_recipients`** (audit). Mechanism: pass `approvedExternalRecipients: string[]` into `sendEmail` — it merges ONLY those addresses into the allowed set, still drops all others, logs distinctly. `filterAllowedRecipients` stays pure; the GA floor is intact for every normal send.

**c) Everything is logged + killable.** Every run writes an `automation_runs` row (status + detail + any external recipients). The GUI (§6) lets an admin see and delete/pause **any** automation. Nothing Gracie schedules is invisible or unkillable.

**d) The catalog bounds the agent.** `create_automation`'s JSON-Schema only accepts the v1 `automation_type` values (§8), so the LLM literally cannot request an action that isn't built. Out-of-catalog requests go to `request_advanced_automation` (§5) → the admin inbox. The bot kill-switch stays OFF/untouched.

---

## 3. Data model — migration `0009_automations.sql`
Idempotent style of `0008`/`0007`; then `supabase gen types` → `database.types.ts`, add hand types (`packages/shared/src/types/automation.ts`) + enums (`packages/shared/src/constants/enums.ts`).

- **enums:** `automation_type` (= the v1 catalog, §8), `automation_status` (`pending_confirmation|active|paused|cancelled`), `automation_run_status` (`success|failed|skipped`), `automation_request_status` (`pending|accepted|dismissed`).
- **`automations`:** `id, owner_user_id (FK users), title, intent (the NL request), type (automation_type), params jsonb, schedule jsonb ({kind:'once'|'interval'|'cron', ...}), recipients jsonb, has_external_recipient bool default false, status default 'pending_confirmation', enabled bool default false, next_run_at, last_run_at, last_run_status, confirmed_at, created_at, updated_at`. Index `(next_run_at) where enabled and status='active'`.
- **`automation_runs`** (audit): `id, automation_id (FK cascade), status, started_at, finished_at, detail, external_recipients text[] default '{}', created_at`. Index `(automation_id, created_at desc)`.
- **`automation_requests`** (advanced inbox): `id, requested_by_user_id (FK set null), intent, status default 'pending', notes, resolved_by_user_id, resolved_at, created_at`.
- **seed:** `settings.automations_external_send_enabled = 'false'` (idempotent).

---

## 4. Worker engine (`apps/worker/src`)
- New queue/processor/scheduler in the established pattern (`automations.queue.ts` + `automations.processor.ts`, wired in `index.ts`; add `QUEUE_NAMES.automations` etc. to `queues.ts`). A tight repeatable sweep (~5 min).
- **Due-sweep:** `select * from automations where enabled and status='active' and next_run_at <= now()`; run each; write an `automation_runs` row; advance `next_run_at` from `schedule` (a `'once'` automation runs then flips to `status='cancelled'`/`enabled=false`). Mirror daily-sync's ET-time helpers for schedule math and its `source:'manual'` bypass for a "Run now" enqueue.
- **Action executors** (v1, §8) — reuse, don't reinvent: report/digest via the daily-sync `gather*` + `brief.ts` + client-detail data (+ `getActiveProvider` for prose); deliver internally via `sendTeamEmail` and/or a `notifications` row (Bell). A `client_send` action delivers externally ONLY through the §2b gated path.

---

## 5. Agentic Assistant (`apps/web`) — the propose→confirm→execute flow
**Constraint that dictates the design:** the two-phase loop (`resolveTools`) discards Phase-1 tool turns, and `insertMessage` persists only `user`/`assistant` rows — so a confirm→execute CANNOT replay a tool turn from history. Therefore:
- Add write tools alongside the read-only ones (new `apps/web/lib/assistant/actions/` executor, mirroring `tools.ts`' registry shape + defensive arg parsing; the caller identity is the fixed turn identity, never from args):
  - **`create_automation`** — validates against the v1 catalog, PERSISTS a `pending_confirmation` `automations` row owned by the caller, returns a JSON proposal (title, type, schedule, recipients, whether external). It does **not** enable/run anything.
  - **`request_advanced_automation`** — inserts an `automation_requests` row + notifies admins; returns a friendly "flagged for your admin" message.
- **Surface the proposal as a confirm card:** extend `ChatMessage` (`components/chat/types.ts`) with an optional structured `action` (the pending automation id + summary); the chat route attaches it when a proposal was created; `ChatBubble` renders a **Confirm / Cancel** card for it (shared component, so it appears on the Assistant + the Intelligence tab). 
- **Execute via a separate gated route** (NOT the stream): `POST /api/automations/[id]/confirm` — owner-or-admin; re-validates; flips `pending_confirmation → active` (schedules) or runs a `'once'` now (enqueue the worker via `apps/web/lib/queue.ts`); an **external-recipient** automation additionally requires the admin switch + `automations.externalSend`. `POST /api/automations/[id]/cancel` deletes the pending row.
- **Prompt:** update `buildAssistantSystemPrompt` — Gracie may now *propose* automations from the catalog (always confirmed before anything happens), escalate out-of-catalog requests to an admin, and otherwise stays read-only. Keep the read-only framing for everything except these explicit, confirmed action tools.

---

## 6. Management GUI (`apps/web`)
- **`/automations` page** (nav item `requires: 'automations.view'`): the caller's automations (admins: all) — title, type, schedule (human-readable), recipients, enabled toggle, **last run (time + status)**, next run; row actions **Run now / Pause-Enable / Delete** (via new `/api/automations/**` routes, `getRequestUser`-gated; enqueue "Run now" through `lib/queue.ts`). Empty/loading/error states.
- **Advanced-requests inbox** (admin): a panel (mirror the Settings `CollapsibleSection` panels) or a section on `/automations` listing pending `automation_requests` with Accept/Dismiss.
- **External-send master switch** (admin): a toggle for `automations_external_send_enabled` (default OFF) — likely in Settings alongside the other admin panels.

## 7. Permissions
Add to `PERMISSIONS` + `PERMISSION_MATRIX`: `automations.view` (all), `automations.edit` (editor — create/manage own), `automations.externalSend` (admin-only capability). Viewer read-only. Gate routes with `getRequestUser`/`isAdmin`/`isEditor` + `can(role, ...)`.

## 8. v1 action catalog (operator-approved)
`client_report` (per-client summary), `portfolio_digest` (across clients / cadence + at-risk), `activity_digest` (yesterday/today rollup — reuse daily-sync gather), `reminder` (a nudge/notification to internal users on a schedule), `client_send` (deliver a report/message to an external client — the gated exception). Each maps to an executor in §4. Additions are a new enum value + executor.

## 9. Out of scope / staging
- **n8n / external integrations** — deferred to Gracie v2.0 (parked brief).
- **UI-authored automations** beyond the chat flow are optional (chat-create is primary; the GUI is manage/kill in v1).
- **SMS delivery** — Gracie SMS add-on (this engine + `/notify`-style paths are what it will extend).
- If the phase is too large for one PR, ship the **build-order prefix** (data model → worker engine → GUI) as PR 1 and the **agentic chat flow + external-exception** as PR 2 — but never ship the write tools without the confirm route + audit.

## 10. Acceptance (before each PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass; migration `0009` applied to the shared Supabase **in coordination with the orchestrator**; types regenerated.
- **Engine:** a hand-inserted `active` automation runs on schedule, writes an `automation_runs` row, advances `next_run_at`; "Run now" works.
- **Safety (critical):** the Assistant only ever *proposes*; nothing activates/sends without the Confirm route; a `client_send` to an external address is BLOCKED unless the admin switch is ON + confirmed, and is written to `automation_runs.external_recipients`; the P7 allowlist tests still pass (7/7) and normal internal sends are unaffected.
- **Boundary:** an out-of-catalog chat request creates an `automation_requests` row (admin inbox), not a broken/faked automation.
- **GUI:** list shows last-run + status; delete/pause/run-now work; viewer read-only; a user sees only their own, an admin sees all.
- Branch + **PR for review** (not `main`); no secrets staged; bot kill-switch untouched.

## 11. Escalate (stop + ask the orchestrator) if
- Persisting the pending action or wiring the confirm card would require changing the P6B.1 read-only guarantees for *anything other than* these explicit confirmed tools.
- The external-send exception can't be implemented as a gated pass-through *inside* the one `sendEmail` choke-point (do not add a second email path).
- Migration `0009` on the shared DB is risky, or an action genuinely needs a capability Gracie doesn't have (→ that's the advanced-requests inbox / v2 n8n, not a boundary crossing).
