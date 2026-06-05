# 09 — Build Phases (Subagent-Ready Work Packages)

> 10 phases. Each is sized to hand to a fresh subagent/terminal with the
> **Delegation Brief** at the end of its section — self-contained, no extra context.
> The master terminal dispatches these; it does not write code itself.

**How to use this doc:** When dispatching a phase, give the subagent: (1) the phase's
Delegation Brief, (2) the doc files it references, (3) the relevant `docs/SECRETS.md`
keys (dev only). Subagents make logical choices within scope and escalate only on
major problems.

**Global guardrails for every subagent:**
- Read `docs/00-overview.md` and `docs/02-tech-decisions.md` first.
- Never reintroduce removed services (Make/Drive/Otter/tldv/Gmail-send/MinIO).
- All AI calls go through the provider interface (D11). Never an SDK directly.
- Frontend never touches R2; backend never blocks on long jobs (enqueue).
- Every component: loading/error/empty states; no placeholder content.
- Never commit secrets. `docs/SECRETS.md` is git-ignored.
- Verify before claiming done (typecheck + lint + the phase's acceptance checks).

---

## Dependency graph

```
P1 Foundation ──┬─► P2 Client Profiles & Files ──┬─► P5 AI Pipeline ─► P6 Intelligence & KB
                │                                  │
                ├─► P3 Tasks & Notes ──────────────┤
                │                                  │
                └─► P4 Calendar ───────────────────┘
                                                   └─► P7 Briefs/Sync/Notifications
P5 ─► P8 n8n
(P1..P7) ─► P9 Settings/Admin/Scoring ─► P10 Testing & Launch
```

**Parallelizable after P1:** P2, P3, P4 can run concurrently (different surfaces).
P5 depends on P2 (files) + P4 (meetings). P6 depends on P5. P9 touches many; do near the end.

---

## Phase 1 — Foundation (Weeks 1–3)

**Goal:** a working app skeleton: monorepo, login, role middleware, Supabase + R2
connected, presigned-URL pattern proven, empty module pages navigable. No AI, no pipeline.

**Scope:**
- pnpm monorepo per `03-project-structure.md` (`apps/web`, `apps/worker`, `packages/*`).
- Next.js App Router shell + sidebar with role-based nav filtering.
- Logto + Microsoft SSO login; `/api/auth/*`; first-login upserts `users`.
- Auth middleware (JWT verify, role gate) on a sample admin-only + editor route.
- Supabase project; run migration from `04-database-schema.sql`; generate types.
- R2 connection + `/api/files/url` presigned-URL issuer with folder authorization.
- Empty pages for all modules so navigation works.

> ### Delegation Brief — P1
> **You are building the foundation of GA App (gracie), a Next.js + Fastify monorepo.**
> Read `docs/00`, `01`, `02`, `03`, `04`, `07`. Set up pnpm workspaces with `apps/web`
> (Next.js App Router), `apps/worker` (Fastify stub), `packages/shared`, `packages/db`,
> `packages/config`. Implement Logto + Microsoft SSO login and `/api/auth/*`; on first
> login upsert a `users` row from JWT claims. Implement auth middleware that verifies the
> Logto JWT and enforces role gates (admin/standard/viewer). Connect Supabase and run the
> migration generated from `docs/04-database-schema.sql`; generate DB types into
> `packages/db`. Connect Cloudflare R2 and implement `GET /api/files/url` that authorizes
> the requested folder path against the `folders` table, then returns a 15-min presigned
> URL. Create empty, navigable pages for every sidebar module with role-based nav filtering
> (Settings hidden for non-admin). **Do NOT** build AI, pipeline, or real module content.
> **Acceptance:** app builds; a user can sign in with Microsoft; role appears in the
> sidebar badge; an admin-only route returns 403 for non-admins; a presigned URL can be
> minted and used to upload a test file to R2; `pnpm -w typecheck && pnpm -w lint` pass.
> **Escalate if:** Logto self-host vs cloud is undecided, or Supabase JWT/role-claim
> wiring is ambiguous.

---

## Phase 2 — Client Profiles & File Browser (Weeks 4–5)

**Goal:** client list + profile (7-tab shell) + the two-panel file browser with real R2
upload/move and folder permissions. No AI yet.

**Scope:**
- Client list (M2) + profile header + 7-tab layout (Finance Admin-only, hidden otherwise).
- Overview/Strategy/Operations read views (data from Supabase).
- File browser (M11): folder tree, file list, breadcrumb; create/rename/move folders;
  upload via presigned PUT; move = copy+delete + update `r2_key`.
- Restricted "Transcripts" folder: visible only to Admin; absent for others.
- Global Documents view (M5) reusing the browser.

> ### Delegation Brief — P2
> **Build client profiles and the file browser for GA App.** Read `docs/03`, `04`, `05`,
> `08`. Implement the Clients list (`/clients`) and Client Profile with the 7-tab layout
> from `docs/08` §9 — the Finance tab and its API must be Admin-only and **completely
> hidden** for others. Build the two-panel file browser (FolderTree, FileList, Breadcrumb)
> used by both the client Documents tab and the global Documents page. Wire folders/files
> to the endpoints in `docs/05` (`/api/folders`, `/api/documents`, `/api/files/url`,
> `/api/files/move`). Uploads use a presigned PUT; moves are backend copy+delete that
> update `documents.r2_key`. Enforce role visibility: restricted folders (e.g. Transcripts)
> are omitted from responses and UI for non-admins. Every component needs loading/error/
> empty states. **Do NOT** add AI/document-generation. **Acceptance:** can browse, create
> folders, upload a file (appears in list + R2), move it, and download it; Transcripts
> folder is invisible to a standard/viewer test user; Finance tab returns 403 + is hidden
> for non-admin; typecheck + lint pass.

---

## Phase 3 — Task Board & Notes (Week 6)

**Goal:** manual task management + notes; immediate team value pre-AI.

**Scope:**
- Task Board (M6): cross-client table, filters, overdue/48h highlighting, archive.
- Create/edit tasks (Editor); Viewer can only mark own task complete.
- Task notes (expandable feed). Client Notes tab (M2A tab 5).

> ### Delegation Brief — P3
> **Build the Task Board and Notes for GA App.** Read `docs/04`, `05`, `08`. Implement the
> cross-client Task Board (`/tasks`) with columns/filters from `docs/08` §M6, overdue rows
> red and due-within-48h rows amber (compute days-overdue from `due_date`). Implement task
> CRUD per `docs/05`: Editors (admin/standard) full; **Viewers may only set `status` on
> tasks they own** (`/api/tasks/:id/complete`). Implement task notes (append-only feed) and
> the Client Notes tab (compose + chronological feed, edit/delete own, admin any). Respect
> RLS/permission rules in `docs/02` §D14. Loading/error/empty states throughout. **Do NOT**
> build task auto-extraction (that's the AI pipeline, P5) — these are manual tasks.
> **Acceptance:** create/edit/complete/archive tasks; filters work; a viewer test user can
> complete only their own task and sees no edit buttons; notes post and render with author +
> timestamp; typecheck + lint pass.

---

## Phase 4 — Calendar Integration (Weeks 7–8) — HIGH COMPLEXITY

**Goal:** Graph calendar scanning (app-level, group-scoped), meeting records, dedup,
client matching, Recall bot dispatch.

**Scope:**
- Microsoft Graph client-credentials client; read calendars of `MS_CALENDAR_GROUP_ID` members.
- Calendar scan cron (30-min, business hours): match events to clients via aliases +
  attendee email domain; dedup by join URL or time+attendees; upsert `meetings`.
- Ambiguous matches → flagged for Admin assignment.
- Bot dispatch cron: ≤5 min before start, dispatch Recall, store `bot_job_id`,
  set `bot_dispatched=true`.
- Calendar UI (M7): month grid + day detail, connection status (= group membership),
  ambiguous list, cadence tracker.

> ### Delegation Brief — P4
> **Build calendar integration for GA App. This is the most complex integration — keep it
> simple first.** Read `docs/01` §calendar, `docs/02` §D5, `docs/05` calendar routes,
> `docs/07` §6. Use Microsoft Graph **application** permissions via client-credentials
> (NOT per-user OAuth). Read only calendars of members of the security group
> `MS_CALENDAR_GROUP_ID`. Implement a 30-min business-hours cron (BullMQ repeatable job in
> `apps/worker`) that: fetches events, matches each to a client using `client_aliases` +
> attendee email domain, **dedups** the same meeting across attendees by join URL or
> time+attendee-set, and upserts `meetings`. Ambiguous (multi-match) meetings get
> `client_id = null` and surface in `/api/calendar/ambiguous` for Admin assignment. Add a
> bot-dispatch cron that dispatches a Recall.ai bot ≤5 min before start (store `bot_job_id`,
> set `bot_dispatched=true`) — exactly one bot per meeting. Build the Calendar UI per
> `docs/08` §M7. **Start with simple alias + domain matching; do NOT build fuzzy NLP
> matching.** **Acceptance:** a test calendar event is detected, matched (or flagged
> ambiguous), deduped across two attendees into one meeting, and a bot dispatch is recorded
> (use Recall sandbox/build key from SECRETS.md); connection panel reflects group
> membership; typecheck + lint pass. **Escalate if:** Graph admin consent / Application
> Access Policy / the security group are not yet provisioned.

---

## Phase 5 — AI Pipeline (Weeks 9–11) — HIGH COMPLEXITY

**Goal:** Recall webhook → ingest → embed → generate 6 docs → extract tasks → store →
notify. Plus the AI provider abstraction (OpenAI adapter).

**Scope:**
- AI provider interface + OpenAI adapter + registry + pinned embedder (`packages/shared`).
- `/api/webhooks/recall` (verify, enqueue). BullMQ pipeline processor in `apps/worker`.
- Ingest: text extract → chunk → embed → `embeddings`.
- 5-layer prompt assembly; sequential generation of all 6 docs; `[VERIFY]` rule.
- Task extraction (structured JSON) → `tasks`; master-record append; `pipeline_runs` log;
  status updates; in-app notification.
- Manual upload pipeline (M3) reusing the same steps.
- Transcript watchdog (90-min) → `needs_attention` + Resend alert.

> ### Delegation Brief — P5
> **Build the AI document-generation pipeline for GA App.** Read `docs/06` (entirely),
> `docs/04` (embeddings, documents, tasks, pipeline_runs), `docs/05` (webhooks, upload),
> `docs/07` (OpenAI, Recall, R2). First implement the **universal AI provider interface**
> in `packages/shared/src/ai/provider.ts` with an **OpenAI adapter** and a registry that
> reads the active provider/model from `settings` and resolves keys via `getCredential`
> (API Settings → env fallback). Embeddings are PINNED to `text-embedding-3-small` (1536-d)
> regardless of generation provider. Implement `POST /api/webhooks/recall` (verify
> signature + `bot_job_id`, enqueue a BullMQ job, return 202). In `apps/worker`, implement
> the pipeline processor exactly per `docs/06` §4: store transcript in R2 → extract → chunk
> → embed → retrieve historical context → generate the 6 documents **sequentially** →
> store in R2 → insert `documents` rows → parse Task Checklist JSON → insert `tasks` →
> append `master_record_entries` → write `pipeline_runs` → set `pipeline_status='complete'`
> → notify attendees. Docs 3 (Client Summary) and 6 (Client Email Draft) are
> `requires_review=true` and never auto-sent. Enforce the `[VERIFY: ...]` prompt rule. Also
> implement the manual-upload pipeline (`docs/06` §5) and the 90-min transcript watchdog
> (`needs_attention` + Resend alert). **Do NOT** build the Intelligence chat (P6) or audio
> transcription (Phase 2/Whisper). **Acceptance:** posting a sample Recall webhook produces
> 6 documents in R2 + `documents` rows, extracted tasks in `tasks`, a master-record entry,
> a `pipeline_runs` row, and an in-app notification; provider is swappable by changing
> settings; typecheck + lint pass.

---

## Phase 6 — Intelligence & Knowledge Base (Week 12)

**Goal:** client-scoped AI chat (pgvector retrieval + streaming) + Knowledge Base module.

**Scope:**
- Intelligence tab (M2A tab 7): scope bar, KB toggle, streaming chat via provider interface,
  client-scoped + role-filtered retrieval (`match_embeddings`).
- Knowledge Base (M9): list/filter, upload modal, embedding on ingest, archive (toggle
  `ai_active`), expiry badges; KB chunks injected when toggle on.

> ### Delegation Brief — P6
> **Build the Intelligence chat and Knowledge Base for GA App.** Read `docs/06` §7,
> `docs/04` (embeddings, knowledge_base_documents), `docs/05` (ai/chat, knowledge-base),
> `docs/08` §M9 + tab 7. Implement `POST /api/ai/chat`: embed the query (pinned embedder),
> call `match_embeddings` client-scoped, optionally include KB chunks (`ai_active=true`)
> when the toggle is on, assemble the prompt, and **stream** the response via the provider
> interface. Retrieval must be role-filtered: never return chunks sourced from content the
> user couldn't otherwise see (e.g. transcripts for non-admins). Build the Intelligence tab
> UI (slate-100 AI bubbles left, blue-600 user bubbles right, markdown bold, textarea +
> Send, Enter/Shift+Enter). Build the Knowledge Base module: table with topic chips + expiry
> badges, filters, upload modal (title/file/tags/description/expiration/AI toggle), embedding
> on ingest, archive toggling `ai_active`. **Acceptance:** asking a client-scoped question
> returns a streamed answer grounded in that client's documents; toggling KB injects KB
> context; a KB doc can be uploaded, embedded, archived; typecheck + lint pass.

---

## Phase 7 — Pre-Meeting Briefs, Daily Sync, Notifications (Week 13)

**Goal:** scheduled briefs + 6 AM daily sync via Resend + in-app notification system + alerts.

> ### Delegation Brief — P7
> **Build briefs, daily sync, and notifications for GA App.** Read `docs/01` §cron,
> `docs/04` (daily_syncs, pre_meeting_briefs, notifications), `docs/05`, `docs/07` (Resend).
> Implement pre-meeting brief generation (cron at the configured lead time) writing
> `pre_meeting_briefs` + R2. Implement the daily sync: 5:45 AM gather → 6:00 AM generate
> (`daily_syncs`) → deliver via Resend to the team. Build the Daily Sync page (today +
> Yesterday tab) per `docs/08` §M8. Implement the in-app notification system
> (`/api/notifications`, bell UI, mark-read) and Resend email alerts for: pipeline failures,
> missing transcripts, calendar disconnects, KB expiry. All times Eastern. **No auto-send of
> client documents.** **Acceptance:** daily sync generates and emails on schedule (test by
> triggering the job manually); briefs generate for upcoming meetings; notifications appear
> in-app and as email for a simulated pipeline failure; typecheck + lint pass.

---

## Phase 8 — n8n & Custom Automations (Week 14)

**Goal:** deploy n8n + backend API endpoints it can call; document the automation framework.

> ### Delegation Brief — P8
> **Set up n8n custom automations for GA App.** Read `docs/01` §n8n boundary, `docs/02`
> §D12–D13, `docs/07` §8. Deploy n8n + its own Postgres on Coolify. Create a service token
> and backend endpoints that n8n can call for: weekly client reports, monthly fee summaries,
> ad-hoc digests. **n8n must call the backend API and the AI provider only — never Supabase
> or R2 directly.** Build one example workflow (weekly client report) end-to-end and document
> how the admin requests new automations. **Acceptance:** n8n runs on Coolify with its own
> DB; the example workflow produces a report by calling backend endpoints; no n8n workflow
> has direct DB/R2 credentials; runbook documented in `infra/`.

---

## Phase 9 — Polish, Settings, Admin Tools (Week 15)

**Goal:** full Settings module incl. **API Settings**, relationship scoring, cadence
tracking, fee-tier weighting, pipeline error log, user management, KB expiry alerts.

> ### Delegation Brief — P9
> **Build the Settings/Admin module for GA App.** Read `docs/05` (settings + API Settings),
> `docs/08` §M12 + §10, `docs/04` (settings, integration_credentials, ai_providers). Build
> the Admin-only Settings page with tabs: Company Settings, Calendar & Automation,
> Integrations, **API Settings**, User Management. **API Settings** backs
> `integration_credentials`: a card per service with masked write-only secret fields, status
> + Test Connection, and AI provider/model selection (embeddings shown read-only/pinned).
> Secrets are encrypted at rest and **never returned** to the client. Implement user
> management (role changes), client aliases, meeting-type rules, fee-tier assignment, KB tag
> management, business hours, brief lead times. Implement relationship health scoring
> (task-completion + meeting-frequency + sentiment signals), cadence tracking, and KB-expiry
> dashboard alerts. The entire Settings area is hidden from non-admins (route + nav).
> **Acceptance:** an admin can change any user's role, set/replace an API key (e.g. Recall)
> and Test Connection succeeds, switch the active AI provider/model, and these take effect;
> non-admin cannot see or reach Settings; secrets never appear in any API response; typecheck
> + lint pass.

---

## Phase 10 — Testing, Security Audit, Launch Prep (Weeks 16–17)

**Goal:** end-to-end tests, security review, performance, production hardening, backups,
monitoring, **key rotation**.

> ### Delegation Brief — P10
> **Harden and launch-prep GA App.** Read all docs; focus on `docs/02` §D14, `docs/01` §7
> security, `docs/SECRETS.md` rotation checklist. Write end-to-end tests covering: each role
> (admin/standard/viewer) permission path, the full meeting pipeline, manual upload, calendar
> dedup, and presigned-URL authorization. Audit: middleware role enforcement on every route,
> presigned-URL expiry + path authorization, RLS coverage, secret handling (no secrets in
> responses/logs/bundles/git history). Performance-test pgvector queries. Harden Coolify
> (backups for n8n-postgres + Coolify config; Supabase + R2 are managed), set up monitoring/
> alerting. **Execute the key-rotation checklist in `docs/SECRETS.md`** (rotate the build
> Recall key and all others) and confirm none ever entered git history. **Acceptance:** all
> e2e tests green; a written security review with no critical findings; rotation checklist
> complete; backup + monitoring documented and verified.

---

## Notes for the master terminal

- **Spike the scary parts first.** Before fully committing P4 and P5, run a tiny throwaway
  spike: one real Recall meeting end-to-end, and one calendar event matched to a client.
  Validate the external dependencies before building polish around them.
- **Dispatch P2/P3/P4 in parallel** once P1 lands (separate surfaces, low conflict).
- **Confirm the open items** in `docs/02` (Hetzner vs DO, Logto self-host vs cloud, Resend
  domain, Recall plan) before their respective phases.
