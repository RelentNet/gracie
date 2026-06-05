# 07 — Integrations

> Per-service setup: credentials needed, env vars, webhooks, gotchas.
> Build-phase secret values live in the git-ignored `docs/SECRETS.md`.
> Rotatable keys are also editable at runtime in **Admin → API Settings**
> (`integration_credentials` table); env vars are the fallback default.

---

## Credential resolution (how the app reads keys)

```
getCredential(service):
  1. integration_credentials row → if is_set → decrypt → use
  2. else → process.env fallback
  3. cached briefly; invalidated when Admin updates a key
```
**Bootstrap** secrets (Supabase, Logto, the encryption key) must come from env —
the app cannot start without them. Everything else can be managed in API Settings.

---

## 1. Recall.ai (meeting bot)

- **Purpose:** dispatch one bot per deduplicated meeting; receive transcript via webhook.
- **Credentials:** `RECALL_API_KEY` _(build key in SECRETS.md — ROTATE before launch)_.
- **Env vars:** `RECALL_API_KEY`, `RECALL_WEBHOOK_SECRET`, `RECALL_REGION` (config).
- **Webhook to register:** `POST https://<app>/api/webhooks/recall` — "transcript ready" / "bot status". Verify signature with `RECALL_WEBHOOK_SECRET`.
- **Setup:**
  1. Create Recall account; note API key + region.
  2. Register the webhook URL (after the app is reachable via Cloudflare Tunnel).
  3. Bot dispatch: `POST` with `video_link` ≤5 min before start; store returned `bot_job_id` on the meeting.
- **Gotchas:** dedup BEFORE dispatch (one bot per meeting regardless of attendee count). Match the inbound webhook to a meeting via `bot_job_id`.
- **Admin → API Settings:** `service = 'recall'`, "Test Connection" pings a lightweight Recall endpoint.

---

## 2. OpenAI (generation + embeddings — first AI provider)

- **Purpose:** document generation (switchable later) + embeddings (pinned).
- **Credentials:** `OPENAI_API_KEY`.
- **Env vars:** `OPENAI_API_KEY`.
- **Models:** generation model selectable in API Settings (`settings.ai_model`); embeddings pinned to `text-embedding-3-small` (1536-dim).
- **Setup:** create key; set in API Settings or env. "Test Connection" → list models.
- **Gotchas:** rate limits → pipeline runs sequentially (D7). All access via the provider interface, never the SDK directly (D11).
- **Admin → API Settings:** `service = 'openai'`; also drives `/api/settings/ai-providers`.

---

## 3. Supabase (Postgres + pgvector — SELF-HOSTED on Proxmox VM) (D15)

- **Purpose:** structured data + vector store.
- **Credentials:** API URL (internal/Tunnel), anon key (frontend, RLS-bound), service-role key (backend, bypasses RLS), JWT secret, DB password.
- **Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
- **Setup (self-hosted via Coolify):**
  1. Deploy the **Supabase self-hosted stack** (Coolify has a one-click Supabase service, or use the official docker-compose). This brings up Postgres + GoTrue + PostgREST + Realtime + Storage + Kong + Studio + meta (~8 containers).
  2. Set strong `POSTGRES_PASSWORD`, `JWT_SECRET`, dashboard creds; generate anon + service-role keys from the JWT secret.
  3. Enable `vector` + `pgcrypto` extensions (in the SQL editor / migration).
  4. Run migration generated from `docs/04-database-schema.sql`.
  5. Configure JWT so Logto's `role`/`sub` claims are readable by `auth_role()`/`auth_uid()` (align `SUPABASE_JWT_SECRET` or validate Logto JWTs at the API layer and set `request.jwt.claims`).
  6. Generate DB types (`supabase gen types` against the self-hosted instance) into `packages/db`.
  7. Map the Postgres data volume to a SAN-backed path (Synology, NVMe-cached).
- **Gotchas:** NEVER ship the service-role key to the browser. RLS is defense-in-depth; API middleware is primary. Tune the ivfflat `lists` as embeddings grow. **You now own backups** — schedule `pg_dump`/PITR (Phase 10), with the encrypted copy going off-site.
- **Bootstrap (env-only):** yes — required at startup.

---

## 4. MinIO (file storage — self-hosted, S3-compatible) (D16)

- **Purpose:** raw file storage on owned infra. S3-compatible — **same API and code as the R2 design**; only endpoint/credentials differ.
- **Credentials:** endpoint URL, access key, secret key, bucket name.
- **Env vars:** `S3_ENDPOINT` (e.g. `http://minio:9000` internal), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=ga-app`, `S3_REGION=us-east-1` (arbitrary for MinIO), `S3_FORCE_PATH_STYLE=true`.
- **Setup (on the Proxmox VM via Coolify):**
  1. Deploy MinIO container; set root user/password; create bucket `ga-app` (+ dev bucket).
  2. Create a scoped access key (read/write on `ga-app` only) for the app.
  3. Backend uses the **AWS S3 SDK** pointed at the MinIO endpoint with `forcePathStyle: true` to issue **presigned URLs** (15-min).
  4. Data path on the VM maps to a volume backed by the Synology SAN (SHR + NVMe cache).
- **Bucket layout:** unchanged — see `01-architecture.md` / `06-ai-pipeline.md` (`clients/[slug]/...`, `knowledge-base/...`).
- **Gotchas:** credentials backend-only; frontend gets presigned URLs only. Move = copy+delete + update `documents.r2_key`. The DB column is still named `r2_key` (path string) — it is storage-agnostic; no rename needed.
- **Disaster recovery (Phase 10):** nightly encrypted sync of `ga-app` to an off-site target (R2 or offsite Synology).
- **Admin → API Settings:** `service = 'r2'` enum reused as the S3 credential slot (label "Object Storage (MinIO)"); config holds endpoint/bucket; secret = access key secret.

> **Note:** the codebase keeps generic S3 env var names (`S3_*`) so swapping MinIO ↔ R2 ↔ any S3 provider is a config change only. Earlier `R2_*` names in `.env.example` are aliased to these.

---

## 5. Logto (auth, in front of Microsoft Entra)

- **Purpose:** identity abstraction; Microsoft SSO today, Google/email later.
- **Credentials:** endpoint, app id, app secret; Microsoft connector configured inside Logto.
- **Env vars:** `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET`.
- **Setup:**
  1. **Self-host Logto on Coolify** (D4/D15) — deploy the Logto container + its Postgres; set the admin console + the app endpoints behind the Cloudflare Tunnel.
  2. Add a **Microsoft/Entra** social connector in Logto (uses the GA Entra login app).
  3. Define roles (admin/standard/viewer) in Logto; ensure they emit as JWT `role` claim.
  4. App: configure callback `/api/auth/callback`; verify JWT in middleware.
- **Gotchas:** role lives in JWT claims → role changes apply on next token issuance. Login (Logto→Entra) is SEPARATE from calendar access (§6).
- **Bootstrap (env-only):** yes.

---

## 6. Microsoft Graph (calendar — app-level, group-scoped) (D5)

- **Purpose:** read team Outlook calendars to detect client meetings.
- **Credentials:** tenant id, client id, client secret (a dedicated Entra app registration — separate concern from login).
- **Env vars:** `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_CALENDAR_GROUP_ID`.
- **Setup (you have tenant admin rights):**
  1. Register an Entra app for GA App calendar access.
  2. Grant **application** permission `Calendars.Read` → **admin consent**.
  3. Create a mail-enabled security group `ga-app-calendar-access`; add the 8 team mailboxes.
  4. Create an **Application Access Policy** binding the app to that group (limits which mailboxes it can read).
  5. Worker uses **client-credentials** flow to call `GET /users/{mailbox}/calendarView`.
- **Onboarding a new hire:** add them to the group. No app change, no re-consent.
- **Gotchas:** scoping to the group (not whole tenant) keeps blast radius tight — important for federal healthcare. "Calendar connected" status = group membership, NOT per-user tokens. Also used for "Stage as Draft" Outlook drafts (separate permission `Mail.ReadWrite` may be needed — confirm at Phase 5).
- **Bootstrap (env-only):** yes (app credentials), but can also surface in API Settings (`service = 'ms_graph'`).

---

## 7. Resend (outbound email)

- **Purpose:** daily sync delivery, alerts, notifications. **No auto-send of client docs.**
- **Credentials:** `RESEND_API_KEY`; a verified sending domain.
- **Env vars:** `RESEND_API_KEY`, `RESEND_FROM` (e.g. `noreply@mail.graceassociates.com`).
- **Setup:** verify domain (SPF/DKIM/DMARC DNS records); create key.
- **Gotchas:** confirm the sending subdomain before Phase 7. Client-facing emails are staged as Outlook drafts via Graph — Resend is for internal/team mail only.
- **Admin → API Settings:** `service = 'resend'`.

---

## 8. n8n (custom automations)

- **Purpose:** configurable/custom automations only (D13). Calls backend API + AI provider; never DB/R2.
- **Credentials:** its own admin login; a backend API token for calling GA endpoints.
- **Env vars (n8n container):** `N8N_BASIC_AUTH_*`, `DB_POSTGRESDB_*` (its own Postgres, D12), `GA_API_TOKEN`.
- **Setup:** deploy n8n + dedicated Postgres on Coolify; create a service token the workflows use to call `/api/*`.
- **Gotchas:** keep n8n strictly off the critical path; never give it Supabase/R2 creds.

---

## 9. Proxmox VM + Coolify + Cloudflare Tunnel (hosting — self-hosted, D10/D15)

- **Purpose:** run the full stack on owned infra; secure ingress with no open ports.
- **Host:** Proxmox (2× Xeon E5-2660 v3, 128 GB RAM) + Synology SAN (SHR, 24 TB + redundant 2×1 TB NVMe cache, 10 GbE).
- **Setup:**
  1. Create a Proxmox VM: **Debian 12, 8 vCPU / 32 GB RAM / 200 GB disk** (D10). Use `virtio-scsi` + write-back caching for the disk.
  2. Install Docker + **Coolify**.
  3. Deploy containers: `web`, `worker`, `redis`, **`supabase` (stack)**, **`minio`**, `n8n`, `n8n-postgres`, `logto`.
  4. Configure Cloudflare Tunnel → route public hostnames to `web` and the Logto console only; keep DB/MinIO/Redis internal.
  5. Set all env vars in Coolify per-service.
  6. Map data volumes (Postgres, MinIO) to SAN-backed storage.
- **Gotchas:** the full self-hosted stack idles ~6 GB RAM — the 32 GB VM has ample headroom (D10). **You own all backups now**: Postgres (`pg_dump`/PITR), MinIO bucket, n8n-postgres, and Coolify config — schedule + send encrypted copies off-site (Phase 10, D16).

---

## Consolidated `.env.example` (reference)

```dotenv
# --- Bootstrap (env-only, required at startup) ---
SUPABASE_URL=                   # self-hosted instance URL
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
APP_ENCRYPTION_KEY=             # encrypts integration_credentials secrets
LOGTO_ENDPOINT=                 # self-hosted Logto URL
LOGTO_APP_ID=
LOGTO_APP_SECRET=
LOGTO_COOKIE_SECRET=

# --- Microsoft Graph (calendar, app-level) ---
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_CALENDAR_GROUP_ID=

# --- Rotatable (fallback; overridable in Admin > API Settings) ---
RECALL_API_KEY=
RECALL_WEBHOOK_SECRET=
RECALL_REGION=
OPENAI_API_KEY=
RESEND_API_KEY=
RESEND_FROM=
# Object storage (self-hosted MinIO; S3-compatible. Same vars work for R2.)
S3_ENDPOINT=                    # e.g. http://minio:9000 (internal)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=ga-app
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# --- Worker / queue ---
REDIS_URL=

# --- n8n (its own container) ---
GA_API_TOKEN=
```

> Actual values during build: see git-ignored `docs/SECRETS.md`.
> Every rotatable key above can be set/replaced in **Admin → API Settings** at runtime.
