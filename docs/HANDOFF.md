# HANDOFF — Continue GA App (gracie) on a New Machine

> Read this first when picking up the project on a new PC. Secrets are NOT in
> this file (git-tracked) — they live in the git-ignored `docs/SECRETS.md` and
> `apps/web/.env.local`, which the previous operator will provide separately
> (or recreate from the handoff prompt). See "Restore secrets" below.

---

## What this project is

**GA App** (codename `gracie`) — a private internal meeting-intelligence platform
for Grace & Associates, a federal healthcare IT consulting firm. Monorepo, fully
self-hosted on the client's own Proxmox VM. Read these in order:
`docs/00-overview.md` → `02-tech-decisions.md` → `01-architecture.md` →
`03-project-structure.md` → `09-build-phases.md`. Schema: `04-database-schema.sql`.
Infra: `11-infra-runbook.md`. Costs: `10-cost-analysis.md`.

## Operating model

- The human is the "master terminal" director; the AI plans + coordinates + writes
  code, dispatching tightly-scoped **subagents** for parallel module work.
- **Minimal intervention**: make logical choices autonomously; only surface MAJOR
  decisions/problems. Use the Question tool for genuine forks.
- **Always verify**: `pnpm -w typecheck && pnpm -w lint && pnpm --filter web build`
  before claiming done. Test against live infra where possible.
- **Never commit secrets.** `docs/SECRETS.md` and `apps/web/.env.local` are
  git-ignored. Confirm with `git check-ignore` before any `git add -A`.
- Commit + push after each verified milestone. Repo: `git@github.com:RelentNet/gracie.git`
  (team repo). The earlier `itkujo/gracie` was migrated here with full history and is being
  retired; the original planning scaffold is preserved on the `archive/planning-scaffold` branch.

## Toolchain

Node 24, pnpm 10.33.0. `pnpm install` at repo root. **Dev machine is now Windows 11 / PowerShell.**

**pnpm-on-PATH gotcha (Windows):** `corepack enable` can't write to `C:\Program Files\nodejs`
(EPERM). pnpm is provided via a corepack **shim added to the User PATH** (dirs:
`%USERPROFILE%\.corepack-bin` and `%LOCALAPPDATA%\corepack-shims`). New terminals pick it up; an
already-open shell may need `$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"` once, or just
use `corepack pnpm@10.33.0` directly.

---

## CURRENT STATE (Phase 1B, ~80% done)

### Done & committed
- Full blueprint (docs 00–11) + Assistant module spec.
- Monorepo scaffold: `apps/web` (Next.js 15 App Router), `apps/worker` (Fastify
  stub), `packages/{shared,db,config}`.
- UI for all modules on **real data** (see below).
- **Self-hosted infra live** on the Proxmox VM, all in Coolify project `gracie`:
  - **Supabase** (14 containers) — schema migrated (24 tables, pgvector,
    `auth_role()`/`auth_uid()`/`match_embeddings`), **seeded** (12 clients, 18
    tasks, 8 users, meetings, folders, documents, notes).
  - **Logto** (auth) — endpoints set to real domains; admin account NOT yet created.
  - **MinIO** — buckets `ga-app` + `ga-app-dev`.
- **Data layer** (`packages/db`): real Supabase server/browser clients + config +
  generated `database.types.ts`. Verified end-to-end (CRUD + pgvector RPC).
- **Modules wired to real data** (DB→API→UI), each with role gating:
  - Clients (list) — admin-only fee/contract fields redacted by API.
  - Tasks (+ notes).
  - Client detail tabs (overview/strategy/finance[admin 403]/operations/notes).
  - Documents + FileBrowser — restricted (Transcripts) folders/docs omitted
    server-side for non-admins (verified).
  - **MinIO file layer**: `/api/files/url` (presigned get/put, path-authorized),
    `/api/files/move` (copy+delete), real Download in FileBrowser. Verified:
    viewer denied restricted transcript (403); viewer PUT denied.
- **Logto is ACTIVE (real auth on).** The `LOGTO_*` env vars are set in
  `apps/web/.env.local`, so `isLogtoConfigured()` is true and the mock fallback is
  OFF — the app requires a real login. Configured via the Management API using the
  M2M "Claude Access" app (see SECRETS.md): a Traditional web app `GA App`
  (`v4yeg6a8wu5kod32xph81`) with redirect URIs, roles admin/standard/viewer, and a
  dev test user `gracieadmin` (admin). Role resolution reads the Logto `roles`
  claim (scope `roles` requested) → `resolveRole` (also honors a `user_role`/
  `app_role` custom claim if added later). Code: `lib/logto.ts`, async
  `getRequestUser()`, `lib/server-auth.ts`, `(app)` layout guard, and `/sign-in` ·
  `/callback` (upserts the users row) · `/sign-out`. Mock identities still live in
  `lib/auth-shared.ts` (used only when the `LOGTO_*` vars are absent).
  **Still TODO:** Microsoft Entra connector (needs Azure tenant creds; 0 connectors
  configured), then remove the dev test user.
- **Worker foundation (`apps/worker`)** — real Fastify + BullMQ service (commit `00999a0`):
  shared ioredis connection, `createQueue`/`createWorker` factories (attempts + backoff),
  sample `heartbeat` repeatable job, `GET /health` (Redis ping), Bull Board at
  `/admin/queues`, graceful shutdown. Queue names + job-payload types in `@gracie/shared`.
  Verified vs live Redis.
- **All infra provisioned + verified:** Redis (Coolify `gracie-redis` + dev socat `:6380`);
  OpenAI (credits active — chat + 1536-dim embeddings work); Recall (region us-west-2,
  webhook secret in env). API keys live ENCRYPTED in `integration_credentials`
  (Admin → API Settings), resolved by `getCredential('<service>')`. See SECRETS.md.

### Now — orchestrated phased build
Logto is ACTIVE and infra is up. Work proceeds as **phased delegation briefs in
`docs/plan/`**, each executed in a fresh low-context session (human = master terminal).
- **Done:** `worker-foundation`; **P5a ingest** (`dd4cf08`); **P5b generation** (`715dc68` — merged:
  Recall webhook → 6 docs → tasks → master record → pipeline_runs → notify + watchdog; verified live).
- **Next:** **P6 Intelligence chat + Knowledge Base** — brief at `docs/plan/p6-intelligence-kb.md`
  (`POST /api/ai/chat` streaming + client-scoped, role-filtered retrieval; KB module + embed-on-ingest).
  Then **deploy / go-live**, P7, P8, P9-finish, P10. **P4 calendar is DEFERRED to the end** (needs Azure).
- **Logto remaining:** add the Microsoft Entra connector (needs Azure) + remove the dev test user `gracieadmin`.

> **Dev env note (2026-06-18, macOS):** the original `APP_ENCRYPTION_KEY` was lost; it was rotated to a
> fresh key and the two `integration_credentials` rows (openai, recall) were re-encrypted under it and
> verified (live 1536-dim embed). New key + raw OpenAI/Recall keys live in git-ignored `docs/SECRETS.md`
> (BACK IT UP). `apps/worker/.env.local` was reconstructed from the live Coolify containers and verified
> end-to-end (Redis auth, MinIO `ga-app-dev` put/get, Supabase). `apps/web/.env.local` (Logto +
> NEXT_PUBLIC_* + REDIS_URL) still TODO. `RECALL_WEBHOOK_SECRET` comes at deploy time (P5b webhook).

### Remaining (broad)
- Deploy `apps/web` + `apps/worker` into Coolify (gracie project) over the internal Docker
  network (note: `gracie-redis` is on the `coolify` network — ensure the worker can reach it);
  then `gracie.graceandassociates.com` goes live.
- Phases (per `docs/plan/` briefs): P5 AI pipeline, P6 intelligence + KB, P6B Assistant,
  P7 briefs/sync/notifications (needs Resend), P8 n8n, P9 settings/admin, P10 hardening +
  KEY ROTATION (incl. the build/test keys in SECRETS.md).

---

## How the app reaches infra (dev)

`apps/web/.env.local` (git-ignored) points at the live Supabase + MinIO via the
**dev-LAN socat proxies** on the VM (`10.200.200.131`):
- Supabase Kong → `http://10.200.200.131:8001`
- MinIO → `http://10.200.200.131:9000`
Run `pnpm --filter web dev` then hit `http://localhost:3000`. The app must be on
the office LAN (or able to route to `10.200.200.131`) for data to load.

## SSH to the VM

`ssh gracie-vm` (config + key restored per the handoff prompt). User `phoenix`,
passwordless sudo. Coolify API token in SECRETS.md lets you manage services via
`http://localhost:8000/api/v1/...` from the VM.

## Known gotchas

- SSH→docker→psql quoting is painful; write SQL/PHP to a file and `docker cp` it
  in rather than inline heredocs with nested quotes.
- Coolify one-click services: created via `POST /api/v1/services` with a `type`
  (e.g. `logto`); MinIO was deployed as a `docker_compose_raw` service (no `type`).
- Coolify localhost server must be `host.docker.internal` / user `root` with its
  on-disk key authorized for root — already fixed.
- Logto compose reads `LOGTO_ADMIN_ENDPOINT` (not `ADMIN_ENDPOINT`) for the admin
  URL. `auth_role()` was fixed to read `user_role`/`app_role` claims.

---

## Restore secrets on the new machine

The previous operator will paste the contents of `docs/SECRETS.md`,
`apps/web/.env.local`, the SSH private key (`~/.ssh/gracie_vm`), and the
`~/.ssh/config` `gracie-vm` block. Recreate those files, `chmod 600` the key, then
`ssh gracie-vm` to confirm access. Everything else comes from `git clone`.

---

## Session Report — P6 Intelligence/KB + First Go-Live (2026-07-01 → 02)

**Delivered**

- **P6 — Intelligence Chat & Knowledge Base** (merged to `main`, squash `1a086ee`, was PR #2):
  - **Streaming `POST /api/ai/chat`** (`runtime=nodejs`, any role): embed query →
    `match_embeddings` (over-fetch) → **role gate** → optional global KB chunks →
    chat-specific prompt assembly → `provider.stream()`. All AI via the provider
    interface (never the OpenAI SDK); embeddings pinned 1536-dim.
  - **Role gate (SECURITY), two layers, mirrors the restricted-folder rule (D14):**
    (1) drop `source_type='transcript'` for non-admins — pure `filterChunksForRole`
    in `@gracie/shared` (`ai/chat.ts`); (2) drop document-backed chunks
    (`upload`/`meeting_document`) whose folder is `restricted` and excludes the role —
    `filterChunksByFolderVisibility` in `apps/web/lib/data/chat-retrieval.ts`. Both
    applied BEFORE top-K. Verified live: admin sees transcript + restricted chunks;
    standard/viewer see neither.
  - **Intelligence tab** (client tab 7): scope bar, KB toggle, slate-100 / blue-600
    bubbles, dependency-free Markdown renderer, Enter=send / Shift+Enter=newline,
    streaming render.
  - **Knowledge Base module (M9):** routes `GET`(any)/`POST`(editor)/`PATCH`(editor,
    archive via `ai_active`)/`DELETE`(admin); `kb-ingest` worker job mirroring the
    ingest processor (`source_type='knowledge_base'`, `client_id=null`, idempotent);
    table + filters + upload modal + archive UI.
  - **NEW `match_kb_embeddings` RPC** — migration `packages/db/migrations/0002_add_match_kb_embeddings.sql`,
    applied to the live DB via postgres-meta `/pg/query`. The shipped `match_embeddings`
    signature is UNCHANGED.
  - Adversarial multi-agent review → 6 findings; **fixed 5** (folder-visibility
    hardening above, KB `GET` auth, wider candidate pool, mid-stream interrupt marker,
    dropped `aria-live` on the streaming thread), **accepted 1** (KB upload not atomic
    on enqueue failure — same shape as the shipped P5a pipeline).
  - Green: `pnpm -w typecheck && pnpm -w lint && pnpm --filter web build`; live role
    filter + KB upload→embed→archive→delete verified.
- **First production deploy / go-live (2026-07-01)** — live at `https://gracie.graceandassociates.com`:
  - Added `apps/web/Dockerfile` + `apps/worker/Dockerfile` (root-context pnpm monorepo;
    commit `3c3b39a`), validated with local `docker build`.
  - Created 2 Coolify apps in project `gracie` / env `production`: `gracie-web`
    (uuid `vp1nsjs9cvdi2nqkdeydjydj`, :3000, domain) + `gracie-worker`
    (`ck7lktaqtpkrr9uk9bzsfnd2`, :3001, no public domain).
  - Wired **real Logto auth** for web (GA App `v4yeg6a8wu5kod32xph81`); repointed
    `REDIS_URL` to the internal Coolify `gracie-redis` (the dev LAN proxy `:6380`
    times out from containers).
  - Initial public **502 root cause:** the office **Nginx Proxy Manager** `gracie`
    host forwarded to `:3000` (not host-exposed); fixed by forwarding to the VM's
    Traefik on **:443** (like `auth`). Verified: apex 200, `/sign-in` → Logto, valid
    LE cert. Full topology in auto-memory `deploy-topology.md`.

**Still to do after P6 (roadmap)**

- **Immediate:** Microsoft Entra ID connector for beta — see "▶ NEXT UP" below (blocked on Entra/Azure tenant-admin access).
- **Prod follow-ups:** (a) map `getRequestUser()`'s `'unauthorized'` throw → **401**
  (currently 500 for session-less API calls, now exposed with Logto enforced);
  (b) `proxy_buffering off;` on the NPM `gracie` host for live chat streaming;
  (c) stabilize the intermittently-dropping VM LAN (`10.200.200.131`).
- **Verification gaps:** a real **browser login round-trip** + a grounded chat answer
  through the *public* path were NOT done (only server-side curl) — do this with a
  real beta user once Entra is in.
- **Config caveats:** `NEXT_PUBLIC_SUPABASE_URL` is the LAN proxy (OK only if the
  browser never calls Supabase directly — app is API-route-centric; confirm). Coolify
  can create duplicate env rows on a bulk env PATCH — check for dupes when editing app env.
- **Later phases:** P6B Assistant (Module 14) · P7 briefs/daily-sync/notifications
  (needs Resend) · P8 n8n · P9 settings/admin finish · P10 hardening + KEY ROTATION
  (incl. the build/test keys in `SECRETS.md`) · P4 calendar (deferred — needs Azure,
  overlaps with Entra).

---

## ▶ NEXT UP — Connect Microsoft Entra ID (for beta testing)  [added 2026-07-02]

**Status:** GA App is **LIVE in production** at `https://gracie.graceandassociates.com`
(deployed 2026-07-01) with real Logto auth + valid TLS. Web + worker run as Coolify
apps on the VM; the office **Nginx Proxy Manager** terminates TLS and forwards the
domain to the VM's Traefik on **:443** (NOT the app's :3000). P1–P3, P5, P6 done.

**THE NEXT TASK (do this first): wire Microsoft Entra ID (Azure AD) into Logto so
Grace & Associates staff can sign in with their Microsoft/work accounts — the
prerequisite for beta testing.** This is the long-deferred "needs Azure" item.

1. **Azure/Entra app registration** (needs Entra tenant admin access — the blocker):
   in the client's Entra tenant, create an App Registration; capture **tenant id,
   client id, client secret**. Add the **redirect URI** Logto shows when you create
   the connector (form: `https://auth.gracie.graceandassociates.com/callback/<connector-id>`).
   Grant delegated `openid profile email` (+ `User.Read`).
2. **Logto connector** at `https://auth-admin.gracie.graceandassociates.com` → add the
   **Microsoft Entra ID (Azure AD)** social/enterprise connector; enter tenant/client/
   secret + scopes; enable it in the **Sign-in Experience**.
3. **Role mapping** — the app resolves its Role from a `user_role`/`app_role` claim
   (Logto JWT customizer / `custom_data`) or Logto RBAC roles, defaulting to
   least-privilege **viewer** (see `apps/web/lib/logto.ts` `resolveRole`, DB `auth_role()`).
   Set up the customizer/RBAC so Entra users get a real role; assign beta users
   admin/standard/viewer.
4. **Remove the dev test user `gracieadmin`** before opening beta.
5. **Verify end-to-end:** sign in at `https://gracie.graceandassociates.com` with a
   Microsoft account → lands authenticated with the correct role; confirm a
   client-scoped chat answer streams and the transcript **role filter** holds for a
   real non-admin beta user.

Full prod topology + gotchas (Coolify apps, NPM→Traefik:443, internal-Redis, Coolify
token location) are in the auto-memory `deploy-topology.md`.

**Smaller prod follow-ups (after Entra, not blockers):** (a) `getRequestUser()` throws
`'unauthorized'` → API routes return **500 instead of 401** for session-less requests
(now exposed since Logto is enforced) — map it to 401; (b) add `proxy_buffering off;`
to the NPM `gracie` host so chat answers stream live; (c) the VM LAN link
(`10.200.200.131`) **drops intermittently** — worth stabilizing.
