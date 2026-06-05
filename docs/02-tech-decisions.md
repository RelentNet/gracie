# 02 — Technical Decisions (Resolved)

> Every decision below is **locked** unless a critical technical blocker emerges.
> Each entry: the decision, the rationale, alternatives considered, and an **Override** line the human can edit to change course.

---

## How to read this

- ✅ **Decision** — what we are doing.
- **Rationale** — why.
- **Alternatives** — what we passed on and why.
- **Override** — left for the human; if changed, downstream docs must be updated.

---

## D1 — Backend topology

✅ **Monorepo (pnpm workspaces): `apps/web` (Next.js App Router) + `apps/worker` (Fastify) + `packages/*` shared.**

- **Rationale:** Document generation can take 60+ seconds (6 sequential AI calls + embedding + file writes). That does **not** belong in serverless Next.js API routes (timeout + cold-start risk). A dedicated long-running Fastify worker with a job queue is the correct home. A monorepo keeps types, the DB client, and the AI-provider interface shared across both without publishing packages.
- **Alternatives:** Single Next.js app (rejected — long jobs); separate repos (rejected — friction sharing types/contracts).
- **Override:** _______________________________________________

---

## D2 — Job queue

✅ **BullMQ + Redis**, Redis running as a Coolify container.

- **Rationale:** The pipeline is async, multi-step, retryable, and observable work. BullMQ is the mature Node standard: retries, backoff, concurrency control, dead-letter, a dashboard. Redis is one small container we already can host on Coolify.
- **Alternatives:** Supabase Edge Functions (too constrained for 60s+ jobs); in-process queue (no durability — a worker restart loses jobs); pg-boss (viable, but BullMQ has better tooling/ecosystem).
- **Override:** _______________________________________________

---

## D3 — Backend language

✅ **Node.js / TypeScript** across the board. **Audio transcription deferred to Phase 2.**

- **Rationale:** Recall.ai already delivers transcript **text** — no transcription needed for the core loop. Keeping one language (TS) across web + worker + shared packages minimizes context-switching and maximizes code reuse. Uploaded audio files (.mp3/.mp4) are an edge case handled later (OpenAI Whisper API when needed — no Python service required).
- **Alternatives:** Python backend for richer text/audio libraries (rejected — splits the stack for a Phase-2 concern; Node has adequate `.docx/.pdf/.csv` extraction).
- **Override:** _______________________________________________

---

## D4 — Authentication / SSO

✅ **Logto now**, self-hosted on Coolify, in front of **Microsoft Entra SSO**. Role claims embedded in JWT; enforced by backend middleware.

- **Rationale:** The human has flagged **resale** as a real possibility (future customers on Google Workspace or email/password). Logto is an identity-provider abstraction: today it points at Microsoft; tomorrow flip on Google/email **without touching app code** — the app only ever sees a Logto JWT with role claims. Philosophically consistent with the universal AI-provider decision (D11). Already self-hosting, so one more container is marginal cost.
- **Note:** Login (Logto→Entra) and calendar reading (D5, app-level Graph) are **separate Microsoft concerns** — decoupled.
- **Alternatives:** Direct Entra SSO, drop Logto (rejected — a later resale to a non-Microsoft customer would force a meaningful auth-layer refactor touching every middleware path).
- **Override:** _______________________________________________

---

## D5 — Calendar access model

✅ **Microsoft Graph `Calendars.Read` application permission (admin consent), scoped via an Application Access Policy to a mail-enabled security group** (e.g. `ga-app-calendar-access`).

- **Rationale:** Removes the entire per-user OAuth token lifecycle (8 grants, refresh, expiry, breakage alerts) — ~40–50% of calendar complexity. The app authenticates as itself (client-credentials) and reads only the calendars of group members. **Onboarding a new hire = add them to the group** — no app change, no re-consent. Scoping to a group (not whole tenant) keeps the blast radius tight, which matters for a federal healthcare firm.
- **Alternatives:** Per-user delegated OAuth (rejected — token lifecycle burden); whole-tenant app permission (rejected — too large a blast radius if credentials leak; group scope gives the same operational ease).
- **Implication for schema:** `users` table does **not** store per-user Microsoft tokens. "Calendar connected" status = group membership.
- **Override:** _______________________________________________

---

## D6 — Real-time updates

✅ **Polling for MVP** (dashboard `/api/dashboard` every 60s; pipeline status every 30s). Plan for **Supabase Realtime** later.

- **Rationale:** Single-digit concurrent users. Polling is trivially correct, easy to debug, and adequate at this scale. Supabase Realtime (websockets over Postgres changes) is the clean upgrade path when warranted — no architectural rewrite needed.
- **Alternatives:** Raw WebSockets (premature infra); Realtime from day one (unnecessary complexity for MVP).
- **Override:** _______________________________________________

---

## D7 — Document generation parallelism

✅ **Sequential** generation of the 6 documents for MVP.

- **Rationale:** 6 concurrent AI calls risk provider rate limits and make failures hard to isolate. Sequential is slower (acceptable — it's background work) but far easier to debug, retry per-step, and reason about. Parallelize later if latency becomes a real complaint.
- **Alternatives:** Parallel (rejected for MVP — rate-limit + debugging cost outweighs latency benefit for background jobs).
- **Override:** _______________________________________________

---

## D8 — Text extraction for uploads

✅ **In scope for launch:** `.docx` → mammoth, `.pdf` → pdf-parse, `.csv` → papaparse, `.txt` → native. **Deferred:** `.mp3/.mp4` audio → Phase 2 (OpenAI Whisper).

- **Rationale:** Covers the documents the team actually uploads (decks, proposals, email threads, transcripts as text). Audio uploads are rare vs. Recall-delivered transcripts.
- **Override:** _______________________________________________

---

## D9 — Embedding model

✅ **OpenAI `text-embedding-3-small`**, **fixed**, accessed through the AI-provider interface (D11).

- **Rationale:** Established, cheap, production-proven for RAG. **Embeddings must be coherent within one pgvector index** — you cannot mix models. So while *generation* is provider-switchable, *embeddings* are pinned to one model. If we ever change embedding models, it requires a versioned index + re-embed (documented as a known future migration, not a day-one feature).
- **Alternatives:** Switchable embeddings (rejected for MVP — index incoherence + re-embed cost); `text-embedding-3-large` (rejected — higher cost/dim for marginal gain at this scale).
- **Override:** _______________________________________________

---

## D10 — Hosting / server (REVISED → self-hosted Proxmox)

✅ **Self-hosted on a single Proxmox VM: Debian 12, 8 vCPU / 32 GB RAM / 200 GB disk.**

- **Context:** GA is a federal healthcare consulting firm; **data residency/compliance** is a primary driver. The client's web-company infrastructure includes a Proxmox host (2× Xeon E5-2660 v3 = 40 threads, 128 GB RAM, ~61 GB free, ~8% avg CPU) backed by a Synology SAN (SHR, 24 TB spinning + redundant 2×1 TB NVMe read/write cache, 10 GbE).
- **Rationale:** The hardware massively exceeds this 8-user workload. Self-hosting keeps all data-bearing services on owned infrastructure (compliance win) at near-zero marginal cost. The redundant NVMe write cache makes write-back safe for Postgres; SHR + SAN covers durability. The workload is I/O/RAM-bound, not CPU-bound (AI/transcription are external APIs), so the older Xeons are more than sufficient.
- **VM spec:** 8 vCPU / 32 GB / 200 GB is comfortable headroom for the full stack (Supabase ~8 containers + Logto + Redis + n8n + n8n-postgres + MinIO + web + worker) plus pipeline bursts; trivial load on the host.
- **"Move later":** because it's a VM, relocating = Proxmox backup/restore or live-migrate the whole VM to other hardware (easy). Avoids the hard "migrate live data between different setups" path.
- **Alternatives:** Hetzner CX42/CPX41 managed VPS (rejected — compliance/residency goal favors owned infra; cloud cost avoided); smaller CPX21/31 (rejected — full self-hosted stack incl. Supabase needs ~6 GB idle RAM, would OOM on first pipeline run).
- **Override:** _______________________________________________

---

## D15 — Self-host everything self-hostable (NEW)

✅ **Self-host every data-bearing service that can be self-hosted; use SaaS only where self-hosting is impossible.**

| Self-hosted (on Proxmox VM, under Coolify) | External SaaS (unavoidable) |
| --- | --- |
| Supabase (Postgres + pgvector) | Recall.ai (meeting bot — SaaS-only) |
| Logto (identity) | OpenAI (AI API — SaaS-only) |
| Redis (BullMQ) | Microsoft Graph (calendar — Microsoft's API) |
| n8n + its Postgres | Resend (email — SaaS) |
| MinIO (file storage — replaces R2, see D16) | |
| web (Next.js) + worker (Fastify) | |

- **Rationale:** Compliance/data-residency. All client data at rest (DB rows, transcripts, generated docs, identity) lives on owned infrastructure. External services are unavoidable processors (cover via BAA/DPA where applicable).
- **Override:** _______________________________________________

---

## D16 — File storage: self-hosted MinIO (REVISES the R2 decision)

✅ **MinIO (S3-compatible) self-hosted on the Proxmox VM as PRIMARY file storage. Encrypted off-site backup (to R2 or offsite Synology) added in Phase 10 for disaster recovery.**

- **Rationale:** Keeps client files (transcripts, generated documents) on owned infra — the most sensitive artifacts, consistent with D15. MinIO speaks the **same S3 API** the code already targets, so **application code is identical to the R2 design** — only the endpoint + credentials differ. Synology SHR + redundant NVMe cache provides local durability.
- **Disaster recovery:** the one thing local storage lacks is off-site survivability (office disaster). Solved as a **backup job** (nightly encrypted sync to R2 or an offsite Synology), not by moving primary storage to the cloud. This is a Phase-10 hardening task.
- **Note:** This intentionally re-introduces an S3-compatible self-hosted store. The earlier "MinIO removed" note from the Planning Prompt was pre-compliance; D15/D16 supersede it. Files remain backend-gated via presigned URLs (unchanged).
- **Alternatives:** Cloudflare R2 (rejected as primary — client file bytes would leave owned infra; retained only as a backup target).
- **Override:** _______________________________________________

---

## D11 — AI provider abstraction (NEW — beyond both source docs)

✅ **Universal provider interface; OpenAI implemented first; provider + model switchable from Settings with per-provider auth.**

- **Rationale:** The human wants to switch AI providers/models via a Settings dropdown if one outperforms another (Claude, OpenAI, etc.). So **no provider is hardcoded.** Define a single interface (`generate`, `stream`, `embed`) in `packages/shared`. Implement an OpenAI adapter first. Adding Claude later = a new adapter against the same contract + a key field in Settings. Build all touch-points (pipeline, intelligence chat, embeddings) against the **interface**, never the SDK directly.
- **Constraint:** Embeddings are pinned (D9) even though generation is switchable.
- **Alternatives:** Hardcode OpenAI (rejected — contradicts explicit requirement); fully switchable incl. embeddings now (rejected — index coherence cost; deferred).
- **Override:** _______________________________________________

---

## D12 — n8n database

✅ **Separate Postgres container** on Coolify for n8n workflow storage.

- **Rationale:** Clean separation of concerns — n8n's internal state should not commingle with application data in Supabase. A small dedicated container is cheap and avoids coupling n8n's schema/version lifecycle to the app DB.
- **Alternatives:** Share Supabase (rejected — mixes concerns, risks accidental coupling).
- **Override:** _______________________________________________

---

## D13 — n8n boundary

✅ **Backend owns the core pipeline. n8n owns configurable/custom automations only. n8n calls the backend API and the AI provider; it never touches Supabase or R2 directly.**

| Backend (core pipeline) | n8n (custom automations) |
| --- | --- |
| Meeting bot dispatch | Weekly client reports |
| Document generation (6 types) | Monthly fee summaries |
| 6 AM daily sync | Ad-hoc digest emails |
| Calendar scanning + dedup | Slack/Teams alerts (future) |
| Pre-meeting brief generation | KB upload notifications |
| Task extraction + writing | Any new automation the admin requests |
| Vector embedding pipeline | Cross-client data digests |

- **Rationale:** Keeps the critical path testable, version-controlled, and inside the app. n8n is for things that change often and benefit from a visual builder the admin can tweak — without risking core data integrity.
- **Override:** _______________________________________________

---

## D14 — Permission matrix (enforced at API middleware)

Enforced server-side on **every** route, not just hidden in UI.

```
Feature                              Admin   Standard   Viewer
──────────────────────────────────────────────────────────────
View client profiles                  ✅       ✅          ✅
View documents & download             ✅       ✅          ✅
View tasks                            ✅       ✅          ✅
View pipeline status                  ✅       ✅          ✅
View daily sync                       ✅       ✅          ✅
View pre-meeting briefs               ✅       ✅          ✅
View Knowledge Base                   ✅       ✅          ✅
Use AI Chat (Intelligence tab)        ✅       ✅          ✅
Read shared notes                     ✅       ✅          ✅
Mark OWN assigned tasks complete      ✅       ✅          ✅
Upload files                          ✅       ✅          ❌
Create / manage folders               ✅       ✅          ❌
Move / rename files                   ✅       ✅          ❌
Delete OWN uploaded files             ✅       ✅          ❌
Add / edit tasks                      ✅       ✅          ❌
Add notes                             ✅       ✅          ❌
Update ANY task status                ✅       ✅          ❌
View restricted folders (Transcripts) ✅       ❌          ❌
View fee tiers / Finance tab          ✅       ❌          ❌
Delete ANY file (not own)             ✅       ❌          ❌
Delete folders                        ✅       ❌          ❌
Access Settings                       ✅       ❌          ❌
Manage users & roles                  ✅       ❌          ❌
Manual pipeline trigger               ✅       ❌          ❌
View pipeline error logs              ✅       ❌          ❌
Configure calendar / alias rules      ✅       ❌          ❌
```

- **Visibility principle:** restricted content is **completely hidden** (not present in the response/UI) for unauthorized roles — not merely disabled.
- **Override:** _______________________________________________

---

## Decisions still genuinely open (flag before the relevant phase)

These are **not** blockers now but should be confirmed before their phase begins:

1. ~~Coolify VPS provider~~ — **RESOLVED (D10):** self-hosted Proxmox VM (Debian 12, 8 vCPU/32 GB).
2. ~~Logto self-hosted vs Cloud~~ — **RESOLVED (D4/D15):** self-hosted on the Proxmox VM.
3. **Resend domain/sender** — which sending domain (e.g. `@graceassociates.com` subdomain). _Confirm before Phase 7._
4. **Recall.ai plan/region** — account tier and data residency. **Flagged: Recall is usage-priced per meeting/recording hour and is often the single largest recurring cost — confirm current pricing for the client cost model.** _Confirm before Phase 4/5._
5. **Off-site backup target** — R2 vs offsite Synology for the encrypted DR copy of MinIO + Postgres (D16). _Confirm before Phase 10._

### Resolved this session (Proxmox pivot)
- **D10** revised: Hetzner CX42 → self-hosted Proxmox VM (Debian 12, 8 vCPU/32 GB/200 GB).
- **D15** added: self-host every data-bearing service possible.
- **D16** added: MinIO (self-hosted) replaces Cloudflare R2 as primary file storage; R2/Synology as backup target later.
- **D4** confirmed: Logto self-hosted (was "leaning").
