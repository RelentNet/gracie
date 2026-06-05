# 01 — Architecture

> Infrastructure, the three-layer data model, the n8n boundary, and request/auth flow.
> Decisions referenced here (D1–D16) are defined in `02-tech-decisions.md`.
> **Hosting:** self-hosted on a Proxmox VM (D10/D15). Supabase, MinIO, and Logto are
> self-hosted; only Recall/OpenAI/Graph/Resend are external SaaS.

---

## 1. High-level topology

```
                          ┌──────────────────────────────────────┐
                          │            Cloudflare                 │
   Team browsers ──HTTPS──▶│   DNS · Tunnel  (no open ports)      │
                          └───────────────┬──────────────────────┘
                                          │ Cloudflare Tunnel
                                          │ (no open inbound ports)
   ┌──────────────────────────────────────▼──────────────────────────────────┐
   │  PROXMOX VM — Debian 12, 8 vCPU / 32 GB / 200 GB  (Coolify)               │
   │  Host: 2× Xeon E5-2660 v3, 128 GB RAM · Synology SAN (SHR + NVMe cache)   │
   │                                                                          │
   │  ┌─────────────┐  ┌───────────────┐  ┌────────────┐  ┌────────────────┐  │
   │  │ web          │  │ worker        │  │ redis      │  │ logto          │  │
   │  │ Next.js      │─▶│ Fastify+BullMQ│  │ (BullMQ)   │  │ (identity,     │  │
   │  │ (UI + API)   │◀─│ (pipeline)    │  │            │  │  self-hosted)  │  │
   │  └─────┬───────┘  └──────┬────────┘  └────────────┘  └────────────────┘  │
   │        │                 │                                                │
   │  ┌─────▼─────────────────▼──────┐  ┌────────────┐  ┌──────────────────┐  │
   │  │ Supabase (self-hosted)       │  │ MinIO      │  │ n8n + its        │  │
   │  │ Postgres + pgvector +        │  │ (S3-compat │  │ Postgres         │  │
   │  │ GoTrue/PostgREST/Storage/... │  │  files)    │  │                  │  │
   │  └──────────────────────────────┘  └────────────┘  └──────────────────┘  │
   └───────────────────────────────┬──────────────────────────────────────────┘
                                   │ outbound HTTPS
        ┌──────────────────────────┼───────────────┬──────────────┐
        ▼                          ▼               ▼              ▼
  Microsoft Graph             Recall.ai         OpenAI         Resend
  (calendars, app-level)      (meeting bot)     (gen+embed)    (email)
        ── external SaaS (unavoidable; cannot be self-hosted) ──
```

### Coolify container inventory (all on the Proxmox VM)

| Container | Purpose | Notes |
| --- | --- | --- |
| `web` | Next.js (App Router) — UI + light/synchronous API routes | Public via Tunnel |
| `worker` | Fastify + BullMQ — long-running pipeline jobs | Internal only |
| `redis` | BullMQ backing store | Internal only |
| `supabase` (stack) | Postgres + pgvector + GoTrue/PostgREST/Storage/Kong/Studio | **Self-hosted** (~8 containers); internal |
| `minio` | S3-compatible file storage (replaces R2, D16) | Internal; presigned URLs only |
| `n8n` | Custom/configurable automations | Internal; admin UI behind auth |
| `n8n-postgres` | n8n workflow storage (D12) | Internal; separate from Supabase |
| `logto` | Identity provider (in front of Entra) | Public auth endpoints via Tunnel |

**External SaaS** (cannot be self-hosted — D15): Recall.ai, OpenAI, Microsoft Graph, Resend.

**Storage durability:** files (MinIO) + Postgres data sit on the Synology SAN (SHR + redundant NVMe write cache). Off-site disaster-recovery backup (encrypted, to R2 or offsite Synology) added in Phase 10 (D16).

### Why Cloudflare Tunnel

No inbound ports are opened on the VPS firewall. Cloudflare establishes an outbound tunnel from the server; all public traffic enters through Cloudflare's edge. This shrinks the attack surface — appropriate for a federal-adjacent tool.

---

## 2. Three-layer data architecture

> **Storage note (D16):** "R2" throughout this doc now means **self-hosted MinIO**
> (S3-compatible). The design is **identical** — same S3 API, same presigned-URL
> pattern, same backend-only credentials. Only the endpoint/credentials differ.
> Mentally substitute "MinIO" for "R2" below.

```
Layer 1 — Supabase pgvector    ← what the AI queries (semantic search)
Layer 2 — MinIO (S3-compatible)← where raw files live (self-hosted)
Layer 3 — In-app file browser  ← what humans see (presigned URLs)
```

### Layer rules (non-negotiable)

1. **AI never reads R2 directly.** On ingest, every document is: stored in R2 → text-extracted → chunked → embedded → written to the `embeddings` table (pgvector). AI retrieval always queries pgvector.
2. **Frontend never touches R2 directly.** All file read/write goes through the backend, which returns a **presigned URL** (15-min expiry). The browser then talks to R2 with that short-lived URL.
3. **R2 credentials are backend-only.** They never reach the browser bundle or client-side env.
4. **Supabase is the permission layer.** R2 stores bytes with no concept of roles. The `folders` table (with `visibility` + `allowed_roles`) decides who may generate a presigned URL for a given path. **Every presigned-URL request is authorized against `folders` first.**

### Ingest flow (applies to both pipelines)

```
raw file → R2 (store)
        → extract text (mammoth/pdf-parse/papaparse/native)
        → chunk
        → embed (OpenAI text-embedding-3-small, via provider interface)
        → embeddings table (pgvector), tagged with source_type + source_id
```

### Retrieval flow (Intelligence chat, pipeline historical context)

```
query text → embed → pgvector similarity search (client-scoped, role-filtered)
          → top-K chunks → assembled into prompt → AI provider → response
```

---

## 3. The n8n boundary (D13)

n8n is **not** part of the critical path. It is a sidecar for automations the admin wants to configure or add over time.

```
Backend (core pipeline)          n8n (custom automations)
──────────────────────────       ──────────────────────────────
Meeting bot dispatch             Weekly client reports
Document generation              Monthly fee summaries
6 AM daily sync                  Ad-hoc digest emails
Calendar scan + dedup            Slack/Teams alerts (future)
Pre-meeting brief gen            KB upload notifications
Task extraction + writing        Cross-client digests
Embedding pipeline               Any new automation requested
```

**Hard rule:** n8n calls the **backend API** and the **AI provider**. It **never** connects to Supabase or R2 directly. This keeps data integrity inside the application's own validated endpoints.

---

## 4. Request & auth flow

### Standard authenticated request

```
Browser
  │  Authorization: Bearer <Logto JWT>
  ▼
Next.js / Fastify route
  ▼
Auth middleware:
  1. verifyLogtoJWT(token) → { userId, role }   (401 if invalid)
  2. route role gate: if requiresAdmin && role !== 'admin' → 403
  3. attach req.user = { userId, role }
  ▼
Handler:
  - resource-level checks (e.g. folder visibility, task ownership)
  - DB query (Supabase) — RLS provides defense-in-depth
  ▼
Response (restricted fields/items omitted entirely for unauthorized roles)
```

### Two layers of enforcement (defense in depth)

1. **Middleware role gate** — coarse: is this role allowed on this route at all?
2. **Resource checks + Supabase RLS** — fine: can *this user* see *this specific row/folder/task*?

Restricted content is **omitted from the response**, not returned-and-hidden. The frontend mirrors this in UX, but the server is the source of truth.

### Login flow (Logto → Entra)

```
Browser → app → redirect to Logto
       → Logto → "Sign in with Microsoft" → Entra OAuth 2.0
       → Entra returns identity to Logto
       → Logto issues JWT (identity + role claims)
       → app stores session; first login: backend upserts users row
       → redirect to Dashboard
```

Role lives in JWT claims, so **role changes take effect on next token issuance** without a code change. Silent token refresh handled by Logto.

### Calendar access flow (app-level, D5)

```
Worker (client-credentials, app identity)
  → Microsoft Graph: GET /users/{mailbox}/calendarView
     (only mailboxes in the ga-app-calendar-access security group,
      enforced by Application Access Policy)
  → match events to clients → dedup → upsert meetings
```

No per-user tokens. "Calendar connected" = membership in the access group.

---

## 5. Job queue & pipeline execution (D1, D2)

```
Trigger (Recall webhook | manual upload | cron)
  → Next.js API route validates + enqueues a BullMQ job (Redis)
  → returns 202 immediately
  ▼
apps/worker (Fastify) BullMQ processor:
  → runs the pipeline steps (see 06-ai-pipeline.md)
  → updates pipeline_runs + meetings.pipeline_status as it progresses
  → on failure: retry w/ backoff; after N retries → status=needs_attention + Resend alert
  ▼
Frontend polls /api/pipeline or /api/dashboard (D6) to reflect status
```

**Why a queue, not inline:** generation is 60s+; HTTP requests must not block on it. Enqueue → 202 → poll is the pattern throughout.

---

## 6. Cron / scheduled jobs

Run by the worker (BullMQ repeatable jobs) — **not** n8n.

| Job | Schedule (ET) | Purpose |
| --- | --- | --- |
| Calendar scan | every 30 min, business hours | detect meetings, dedup, dispatch bots |
| Bot dispatch check | every ~1 min near meeting starts | dispatch Recall bot ≤5 min before start |
| Transcript watchdog | continuous after meeting end | 90-min window; else `needs_attention` + alert |
| Pre-meeting brief gen | per brief lead time | generate + (optionally) deliver brief |
| Daily sync prep | 5:45 AM | gather the day's data |
| Daily sync send | 6:00 AM | generate + Resend to team |

---

## 7. Security posture (summary; expanded in 07-integrations.md)

- No inbound ports (Cloudflare Tunnel).
- Role checks on **both** frontend and backend; RLS as defense-in-depth.
- R2 access only via short-lived presigned URLs; credentials backend-only.
- Calendar access scoped to a security group (tight blast radius).
- Secrets in Coolify env / a secrets manager — never in the repo, never in client bundles.
- Client-facing documents are **never auto-sent** — staged as drafts, explicitly approved by a human.
- `[VERIFY: ...]` tags on AI-uncertain content (prompt-enforced) surface in amber for human review.

---

## 8. Environments

| Env | Where | Purpose |
| --- | --- | --- |
| Local dev | developer machine | Supabase (dev), MinIO dev bucket, Logto dev tenant |
| Production | Coolify VPS | live team usage |

Staging is optional for MVP; if added, mirror prod with separate Supabase/MinIO/Logto instances. Each env has its own credentials and its own MinIO bucket prefix.
