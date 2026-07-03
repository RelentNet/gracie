# Delegation Brief — P4: Calendar Integration (auto meeting pipeline front-end)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. **HIGH COMPLEXITY — keep it simple first.**
> This builds the FRONT of the automatic meeting pipeline (calendar scan → client match →
> Recall bot dispatch). The BACK (webhook → transcript → 6 docs) is P5b, already merged —
> P4 just has to dispatch a bot and set `meetings.bot_job_id` so the P5b webhook picks it up.

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current state (P1–P6 + P6B + SSO done; live in prod).
- `docs/09-build-phases.md` — **the P4 Delegation Brief** (Phase 4 section) — the authority for scope.
- `docs/07-integrations.md` — **§6 Microsoft Graph** (calendar, app-level, group-scoped) + §3 Recall (bot dispatch).
- `docs/01-architecture.md` §calendar · `docs/02-tech-decisions.md` §D5 · `docs/05-api-route-map.md` calendar routes · `docs/08-design-system.md` §M7 (Calendar UI).
- `docs/04-database-schema.sql` — `meetings` (esp. `calendar_event_id`, `bot_dispatched`, `bot_job_id`, `pipeline_status`, `attendee_user_ids`, `meeting_lead_user_id`, `client_id`), `client_aliases`, `users`.

### Existing code to BUILD ON / reuse (do NOT duplicate)
- `apps/worker/` — the BullMQ foundation: `createQueue`/`createWorker` factories, the **repeatable-job** pattern (see the P5b watchdog `apps/worker/src/processors/watchdog.processor.ts` + `queues/watchdog.queue.ts` for a scheduled cron example), shared ioredis connection.
- **The P5b pipeline is the back half** — P4 dispatches a Recall bot and stores `bot_job_id`; when the meeting ends, Recall calls `POST /api/webhooks/recall` (already built) which enqueues the P5b generation. **Do NOT rebuild any generation.** P4's job ends at "bot dispatched, `bot_job_id` stored."
- `getCredential('recall')` (from `@gracie/db`) for the Recall API key; `RECALL_REGION` env. Recall client pattern already used in `apps/worker/src/lib/recall.ts` (P5b) — reuse/extend it for bot **dispatch**.
- `getServerClient()` for DB writes.

## Env (ALREADY WIRED + partly verified)
`apps/worker/.env.local` now has `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_CALENDAR_GROUP_ID` (+ the existing Supabase/MinIO/Redis/OpenAI/Recall). **Verified via spike:** app-only client-credentials auth works and `Group.Read.All` lists the scan group's members. Calendar reads are gated by an Exchange **Application Access Policy** (the app can read ONLY members of `MS_CALENDAR_GROUP_ID` — everything else 403s by design). Copy the env into a fresh worktree (`cp /Users/phoenix/code/gracie/apps/worker/.env.local apps/worker/.env.local`).

## Global rules (non-negotiable)
- **Microsoft Graph = app-only (client-credentials)**, NOT per-user OAuth. Token from `https://login.microsoftonline.com/{MS_TENANT_ID}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`); cache + refresh the token. Read ONLY calendars of `MS_CALENDAR_GROUP_ID` members (the access policy enforces this — handle 403 gracefully).
- **Start SIMPLE:** match a meeting to a client by `client_aliases` + attendee email **domain** only. **NO fuzzy/NLP matching.**
- **Exactly one bot per meeting.** Dedup the same meeting across attendees BEFORE dispatch.
- **Respect the per-user opt-out** (below) — never dispatch a bot for a meeting whose lead opted out.
- Never commit secrets (`git check-ignore` before `git add`; env files + `docs/SECRETS.md` git-ignored). Verify before done; strict TS, `.js` specifiers, JSDoc; loading/error/empty states.

## Scope — build this
1. **Graph client** (`apps/worker/src/lib/graph.ts`): app-only token (cached) + helpers to (a) list `MS_CALENDAR_GROUP_ID` members, (b) read a member's `calendarView` for a time window. Tolerate 403 per-mailbox (log + skip).
2. **Calendar scan cron** (BullMQ repeatable, ~30 min, business hours ET): for each group member → read their calendarView (today + near horizon) → for each event: **match** to a client (`client_aliases` alias hit OR attendee email domain), **dedup** the same meeting across attendees (by join URL, else time + attendee-set), and **upsert `meetings`** (unique `calendar_event_id`; set `attendee_user_ids`, `meeting_lead_user_id`, `date_time`, `video_link`, `pipeline_status='scheduled'`). **Ambiguous** (multi-client match) → `client_id = null`, surfaced for Admin assignment.
3. **Bot-dispatch cron** (repeatable, ~1–2 min): select meetings starting **≤5 min** out, `bot_dispatched=false`, `client_id` set, **AND the lead has NOT opted out** → dispatch a Recall bot (via `getCredential('recall')` + `RECALL_REGION`; extend `lib/recall.ts`), store `bot_job_id`, set `bot_dispatched=true`. Idempotent — never two bots for one meeting.
4. **Per-user "don't auto-join my meetings" opt-out** (user-requested): add a `users` column (e.g. `auto_join_meetings boolean not null default true`) via a migration (mirror P6's `packages/db/migrations/0002…`); the bot-dispatch cron **skips** a meeting when its `meeting_lead_user_id` has `auto_join_meetings = false`; a **per-user settings toggle** (all roles) at the route + a small UI control. Default = auto-join ON.
5. **Routes + UI:** `GET /api/calendar` (meetings for the grid), `GET/POST /api/calendar/ambiguous` (list + Admin assign a client), the opt-out toggle route. **Calendar UI** (`docs/08` §M7): month grid + day detail, a **connection-status** panel (reflects group membership), the ambiguous-meeting list (Admin), and a cadence tracker. Loading/error/empty states.

## Out of scope (DO NOT build)
- Any document **generation** / transcript handling / the Recall **webhook** — that's P5b (merged). P4 stops at bot dispatch.
- Fuzzy/NLP client matching; Resend email alerts (P7); calendar **write-back** to Outlook.

## Acceptance (all must pass before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- With the worker running: a **test calendar event** on a scan-group member's calendar (e.g. `jgrace@` / `dvelez@`) is detected, **matched** to a seeded client (or correctly flagged **ambiguous** with `client_id=null`), and **deduped** across two attendees into ONE `meetings` row.
- A due meeting triggers **exactly one** Recall bot dispatch — `bot_job_id` stored, `bot_dispatched=true` (use the Recall build/sandbox key).
- **Opt-out works:** set a lead's `auto_join_meetings=false` → that meeting gets **no** bot; set it true → it does.
- The connection panel reflects group membership; the ambiguous list lets an Admin assign a client.
- Branch + **PR for review** (do NOT push to `main`); `git status` shows no secrets staged.

## Escalate (stop + ask the orchestrator) if
- Graph **calendar reads still 403** after the Application Access Policy has fully propagated (>~1h) — the orchestrator will confirm the policy/spike; don't hack around it.
- The Recall **bot-dispatch** endpoint/region or webhook-registration contract is unclear (the webhook secret isn't provisioned until deploy — dispatch can still be tested/recorded with the build key).
- Dedup or the alias/domain matching is genuinely ambiguous vs `docs/09` / `docs/04` — confirm, don't guess.
- Anything would force a change to the shipped P5b webhook/generation or the worker factories.
