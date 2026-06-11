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

Node 24, pnpm 10.x. `pnpm install` at repo root. macOS dev so far (zsh).

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

### Paused at (the immediate next step)
**Activate Logto** (code is staged — see above). Endpoints are live:
- Sign-in: `https://auth.gracie.graceandassociates.com` (OIDC issuer verified)
- Admin console: `https://auth-admin.gracie.graceandassociates.com`

Remaining steps, in order:
1. **HUMAN: create the Logto admin account** at the admin console URL (first-run,
   can't be API'd).
2. **HUMAN: create the GA App application** — type *Traditional Web (Next.js)*;
   redirect URI `http://localhost:3000/callback` (+ prod
   `https://gracie.graceandassociates.com/callback`); post-sign-out
   `http://localhost:3000/`. Define roles admin/standard/viewer and a **custom
   JWT claim `user_role`** (the `user_role`/`app_role` claim is what `auth_role()`
   and `lib/logto.ts resolveRole()` read — NOT Supabase's top-level `role`).
   Configure the **Microsoft Entra** connector.
3. **Set the secrets** in `apps/web/.env.local` (commented placeholders already
   there) — `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`,
   `LOGTO_COOKIE_SECRET` (32+ random chars), `LOGTO_BASE_URL` — and the same in
   Coolify for prod. Once present, `isLogtoConfigured()` flips on and real auth
   activates (no code change).
4. **Verify** real Microsoft login + admin/standard/viewer gating end-to-end, then
   implement the `TODO(auth)` in `/callback`: upsert the `users` row from the
   verified claims on first login (docs/01 §4).

### Remaining Phase 1B + beyond
- Logto auth (above) → replace mock auth everywhere.
- Deploy `apps/web` + `apps/worker` into Coolify (gracie project) so they reach
  services over the internal Docker network; then `gracie.graceandassociates.com`
  (:3000) goes live.
- Later phases (09-build-phases.md): calendar (P4), AI pipeline (P5),
  intelligence + KB (P6), Assistant (P6B), briefs/sync/notifications (P7), n8n
  (P8), settings/admin (P9), hardening + KEY ROTATION (P10).

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
