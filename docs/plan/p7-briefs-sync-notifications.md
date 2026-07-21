# Delegation Brief — P7: Briefs · Daily Sync · Notifications (email via Resend)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §2 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Adds pre-meeting briefs, a daily sync digest, and an in-app + email notification system — **internal/team email only, via Resend.**
> **Branch + PR for review. Do NOT push to `main`.**
> ⚠️ **§3 (the email allowlist) is a hard safety rule — read it before writing any send code.**

---

## 0. Read first (cold-start context)

- `docs/09-build-phases.md` **Phase 7** (the original P7 brief) · `docs/07-integrations.md` **§7 Resend** · `docs/01-architecture.md` **§6 cron** (all times **Eastern**) · `docs/08-design-system.md` **§M8 Daily Sync** + M1 Dashboard banner.
- `docs/04-database-schema.sql` / `packages/db/src/database.types.ts` — `notifications`, `daily_syncs`, `pre_meeting_briefs` (all already exist), `settings`, `users`, `meetings`, `clients`, `master_record_entries`, `tasks`.

### What already exists vs. greenfield (mapped by the orchestrator — trust, then verify)
**Reuse (already done):**
- **Resend is already a wired credential** — `getCredential('resend')` (`packages/db/src/credentials.ts`) resolves stored→decrypted secret, else env `RESEND_API_KEY` (set in `apps/worker/.env.local`). `resend` is in the `integration_key` enum + `MANAGEABLE_SERVICES` + the API-Settings UI (`apps/web/app/(app)/settings/ApiSettingsPanel.tsx`) renders its row automatically. **No credential migration needed.**
- `notifications` table + **two existing writers** (worker): `generate.processor.ts` `notifyAttendees()` (`documents_ready`), `watchdog.processor.ts` `notifyLead()` (`needs_attention`). `notification_type` enum already has `documents_ready, needs_attention, task_assigned, kb_expiring, calendar_disconnect, pipeline_failed`.
- **Cron/queue pattern:** `apps/worker/src/queues/{calendar-scan,watchdog}.queue.ts` + `processors/*` + `index.ts` wiring; constants in `packages/shared/src/constants/queues.ts` (`QUEUE_NAMES`/`JOB_NAMES`/`JOB_SCHEDULER_IDS` — header already anticipates "daily-sync, brief"). Payloads in `packages/shared/src/types/job.ts`.
- **Fetch-adapter pattern:** `apps/worker/src/lib/recall.ts` (dependency-free `fetch`, key injected by caller) — the model for the Resend adapter.
- All the read data-layer shapes: `apps/web/lib/data/client-detail.ts` (`getClientDetail/getClientMeetings/getLatestClientMeeting/getClientTasks/getClientMasterRecord`), `tasks.ts` (`getTasksByClient`), `calendar.ts` (`listCalendarMeetings/listClientCadence`), `users.ts` (`listUsers` → id/name/email/deactivated_at). The worker reads directly via `getServerClient()` (the `server-only` web fns can't be imported into the worker — replicate the query shapes).

**Greenfield (build):** the Resend email adapter; the daily-sync + pre-meeting-brief cron jobs (the `daily_syncs`/`pre_meeting_briefs` tables are **empty shells** — nothing writes them yet); the entire **web notification surface** (`/api/notifications`, a bell/inbox in the app shell, mark-read) and the **Daily Sync page** (Today + Yesterday); wiring the four alert emissions; `RESEND_FROM` wiring; a Resend probe in the Test-Connection route.

**No schema migration is required** — all tables + enums already exist. P7 seeds a few `settings` rows (data, not DDL). *(So P7 does not consume migration `0008`, which is reserved for the Contacts phase.)*

---

## 1. Operator's locked decisions
1. **Daily sync** → all **active** staff (`users` where `deactivated_at is null`), ~**6:00 AM ET** (gather ~5:45).
2. **Pre-meeting briefs** → generated **morning-of**, **bundled into the daily-sync email** so each person gets one 6 AM email (sync + that day's briefs), briefs also viewable in-app. *(FLAG: recipients spec'd as all active staff per "each member of the graceandassociates.com domain"; if the operator meant only each meeting's internal attendees, that's a one-line recipient change — confirm.)*
3. **System alert emails** (all four: `pipeline_failed`, missing-transcript `needs_attention`, `calendar_disconnect`, `kb_expiring`) → **email to Admins only** (in-app notifications still go to the relevant user as today).
4. **Resend = internal/team email ONLY.** No client-facing email, **no auto-send of client documents** (the plan stages client email as Outlook drafts via Graph, later). 

---

## 2 & 3. ⚠️ HARD SAFETY RULE — the email allowlist (build this FIRST)

**Gracie may only ever send email to `@graceandassociates.com` recipients — in any capacity.** This is non-negotiable and must be structurally impossible to violate:

- **One choke-point.** All outbound email goes through a single `sendEmail()` in `apps/worker/src/lib/resend.ts`. **No processor may call the Resend API directly.**
- Inside `sendEmail`, **filter every recipient** against the allowlist BEFORE calling Resend: keep only addresses whose domain (case-insensitive, after the last `@`) is in the allowed set; **drop** the rest and `log.warn` each dropped address. If **zero** recipients remain, **do not call Resend** (log a skip).
- Allowed domains come from `settings.email_allowed_domains` (seed default `'graceandassociates.com'`; comma-separated; parse defensively). Deliberately **separate** from `internal_email_domains` (which includes the `onmicrosoft` routing domain — NOT a real mailbox; do not email it).
- **Tests are part of acceptance:** a unit test proving `sendEmail` drops `client@va.gov` / `someone@gmail.com`, keeps `x@graceandassociates.com`, and no-ops when all recipients are external. The allowlist filter must be a pure, testable function.
- `from` = `RESEND_FROM` (must be an address on the Resend-verified domain — operator provides; see §7). The `from`/verified domain is separate from the recipient allowlist, but both live on `graceandassociates.com`.

---

## 4. Resend email adapter — `apps/worker/src/lib/resend.ts`

Mirror `recall.ts` (dependency-free `fetch`, key injected by caller; throw-on-non-OK so BullMQ retries):
- `filterAllowedRecipients(to, allowedDomains): { allowed, dropped }` — pure (the §3 guard).
- `sendEmail({ from, to, subject, html, text }, deps)` — resolves the key via `getCredential('resend')`, applies the allowlist, `POST https://api.resend.com/emails` with `Authorization: Bearer <key>`, returns the Resend id; on non-OK throws. Batches/loops recipients as needed (Resend supports arrays).
- A small **HTML email layout** helper (inline styles; simple GA-branded shell) shared by sync/brief/alert emails. Keep templates in `apps/worker/src/lib/email-templates/` (or inline) — plain, robust, no external assets.
- Optionally promote to `packages/shared/src/email/` only if a web route needs to send directly (none does today — keep it worker-side).
- Wire a **live Resend probe** into `apps/web/app/api/settings/integrations/[service]/test/route.ts` (mirror the OpenAI probe) so "Test Connection" validates the key.

---

## 5. Notification system (in-app + alert emails)

**Web surface (greenfield):**
- `apps/web/lib/data/notifications.ts` — `listNotifications(userId, { unreadOnly? })`, `getUnreadCount(userId)`, `markRead(userId, ids[])`, `markAllRead(userId)` (all scoped to the caller — `.eq('user_id', self)`).
- `apps/web/app/api/notifications/route.ts` (`GET` list + unread count for the current user via `getRequestUser()`), `apps/web/app/api/notifications/read/route.ts` (`PATCH` mark-read / mark-all). Caller-scoped only.
- A **bell/inbox** in the app shell (near the sidebar/header) — unread badge, dropdown list (title/body/link/time), mark-read on open, "mark all read". Follow existing component conventions; loading/empty states.

**Alert emails (to Admins):** ensure all four alert types are **emitted in-app** and **emailed to admins**:
- Emissions: `pipeline_failed` (generation/pipeline failure catch), missing-transcript `needs_attention` (watchdog — the `watchdog.processor.ts` L8–9 TODO explicitly waits for this), `calendar_disconnect` (calendar-scan, when a member's `calendar_connected` flips true→false), `kb_expiring` (a check over `knowledge_base_documents` nearing expiry — small nightly check, or fold into the daily-sync job).
- Add a worker helper `emailAdminsForAlert(notification)` → look up admin users (`users` where `role='admin'` and active), `sendEmail` (allowlist-gated) with a concise alert template + link. Call it wherever an alert notification is written. **In-app** rows for these keep going to the relevant user as today; only the **email** is admin-scoped.

---

## 6. Daily sync — `apps/worker` cron + web page

**Cron** (`queues/daily-sync.queue.ts` + `processors/daily-sync.processor.ts`, wired in `index.ts`; add `QUEUE_NAMES.dailySync`/`JOB_NAMES`/`JOB_SCHEDULER_IDS`/interval to `queues.ts`). **6:00 AM ET wall-clock**: BullMQ schedulers use fixed `every: ms` intervals, so either use a cron `pattern` with `tz: 'America/New_York'`, or an interval sweep that no-ops unless it's the 6 AM ET window (mirror how `calendar-scan` gates on business hours via `isWithinBusinessHours`). A `source='manual'` payload must bypass the time gate (for testing) — mirror calendar-scan.
- **Gather + generate** the digest → write `daily_syncs` (`sync_date`, `content` jsonb, `meeting_ids_included`, `generated_at`). Content: yesterday's activity (meetings processed, docs generated, tasks created/completed), today's schedule (meetings + leads), and at-risk clients (low/ declining `relationship_health`). Optionally use the AI provider (`getActiveProvider`) to prose-summarize; keep structured data too.
- **Generate that day's pre-meeting briefs** (§7) and **include them** in the same morning email.
- **Deliver** via `sendEmail` to all active staff (allowlist-gated); set `delivered_at`. Idempotent per `sync_date` (don't double-send).

**Web page** (`apps/web/app/(app)/daily-sync/page.tsx` is currently a `PagePlaceholder`): **Today** + **Yesterday** tabs (`docs/08 §M8`), reading `daily_syncs` via a new data-layer fn + route. Add the **Daily Sync banner** to the Dashboard (M1).

## 7. Pre-meeting briefs — `apps/worker` (morning-of)

- In the morning run (own processor, or a step of the daily-sync job), for each of **today's** meetings, build a brief from the client's recent context: latest `master_record_entries`, recent meetings, open `tasks`, `relationship_health`, attendees, last-meeting summary. Optionally AI-compose.
- Write `pre_meeting_briefs` (`meeting_id`, `content`, `r2_key` optional if you also store to storage, `generated_at`, `delivered_at`, `delivered_to_user_ids`). Idempotent per meeting per day.
- **Deliver** bundled into the daily-sync email (§6) to all active staff (allowlist-gated); set `delivered_at`/`delivered_to_user_ids`. Make briefs **viewable in-app** (a brief view on the meeting/calendar or the daily-sync page).
- *(Recipient FLAG from §1.2 — all-staff vs. meeting attendees — is a single change point; keep it centralized.)*

## 8. Config (settings — data, not DDL)
Seed idempotently (via the `/pg/query` path used for prior migrations, or a tiny idempotent SQL seed file — no schema change): `email_allowed_domains='graceandassociates.com'`; a daily-sync send-time/enabled config; a brief lead-time/enabled config. Read them in the worker (defensive defaults if unset). Also wire `RESEND_FROM` (env in `apps/worker/.env.local`, and/or the non-secret `config` JSON on the `resend` integration row surfaced by `listIntegrations()`).

## 9. Out of scope (do NOT build)
- **Any client-facing / external email** (allowlist forbids it) and **auto-sending client documents** — client email is a later Graph-drafts feature.
- SMS (that's the Gracie SMS add-on — but P7's notification layer is what it will plug into later).
- New `notification_type` enum values (the four alerts + existing types are enough — avoid a migration).
- Touching the AI generation pipeline internals or the bot kill-switch (`calendar_bot_dispatch_enabled` stays OFF).

## 10. Acceptance (all before the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- **Allowlist (critical):** unit test proves `sendEmail`/`filterAllowedRecipients` drops non-`graceandassociates.com` recipients, keeps allowed ones, and no-ops when all are external. Manually: a send targeting a mixed list only reaches the GA address.
- **Daily sync:** a manual-trigger run generates a `daily_syncs` row and emails all active staff (verify via Resend dashboard / a test GA inbox); the Daily Sync page shows Today + Yesterday; the Dashboard banner renders.
- **Briefs:** the morning run generates `pre_meeting_briefs` for the day's meetings and they appear in the email + in-app.
- **Notifications:** the bell shows the current user's notifications with unread count + mark-read; a simulated `pipeline_failed` produces an in-app row AND an email to admins (only) — allowlist-gated.
- `RESEND_FROM` is a verified-domain address; the Settings "Test Connection" probe for Resend passes.
- Branch + **PR for review** (not `main`); `git status` shows no secrets staged (`RESEND_API_KEY` stays in the git-ignored `.env.local`).

## 11. Escalate (stop + ask the orchestrator) if
- The verified `RESEND_FROM` sending address/domain isn't available yet (operator is providing it) — you can build + unit-test the allowlist without it, but live send needs it.
- 6 AM ET scheduling can't be done cleanly with the existing scheduler (choose cron-pattern+tz vs. gated interval sweep and note it).
- Emitting any of the four alert types would require changing the P5b pipeline contract or the calendar scan in a non-additive way.
- The allowlist would need to be relaxed for any reason — do NOT relax it; escalate.
