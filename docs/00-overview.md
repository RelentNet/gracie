# 00 — System Overview

> **Status:** Technical blueprint (planning). No application code exists yet.
> **Audience:** Any developer or AI subagent picking up a phase of work.
> **Read this first.** It establishes shared vocabulary, the operating model, and how to resolve conflicts between source documents.

---

## 1. What we are building

**GA App** (codename `gracie`) is a private, internal web platform for **Grace & Associates** — a federal healthcare IT consulting firm with an **8-person team** and **~30 active clients**.

It automates the client-relationship lifecycle: meeting capture, AI document generation, task tracking, and team alignment.

### The core loop

```
Client meeting happens
  → Recall.ai bot joins & records
  → transcript delivered (~seconds after meeting ends)
  → AI pipeline generates 6 documents automatically
  → tasks extracted and written to the task board
  → team receives a 6:00 AM ET daily briefing with everything for the day
```

### The business problem

Today the GA team writes meeting notes by hand, drafts follow-up emails manually, tracks tasks in spreadsheets, and aligns over email threads. At ~30 clients with multiple monthly meetings each, this is a large hidden time cost. GA App eliminates the manual middle.

### Scale (right-sizing expectations)

| Dimension | Value |
| --- | --- |
| Team members (users) | ~8 |
| Active clients | ~30 |
| Meetings/week | dozens, not thousands |
| Concurrent users | single digits |

This is an **internal power-user tool**, not a consumer-scale SaaS — yet (see resale note below). Design for correctness, clarity, and maintainability over extreme scale.

---

## 2. Operating model (how this project is run)

- **Master terminal:** The lead session understands the entire system but **does not write application code**. It plans, coordinates, and dispatches.
- **Subagents / fresh terminals:** Each build phase is handed to a fresh, scoped agent with a self-contained **delegation brief** (see `09-build-phases.md`). This keeps each task fast, clean, and low-context.
- **Minimal intervention:** Implementers make logical choices autonomously within the locked decisions. Escalate to the human only for **major** choices or blocking problems.

Every document in `/docs` is written to be **delegatable** — readable cold by a fresh agent without external context.

---

## 3. Source documents & conflict resolution

This blueprint reconciles **two** input documents:

1. **Figma Spec (v1)** — the UI/UX + design-system source. Most current for *look, layout, component behavior, role-visibility UX, mock data*. The human has invested the most time here.
2. **Claude Code Planning Prompt (v1)** — the architecture + data-model + pipeline source. Authoritative for *stack, infrastructure, schema, pipeline, permissions enforcement*.

### Resolution rule

```
UI / UX / design / component behavior   → Figma Spec wins
Architecture / data / pipeline / infra  → Planning Prompt wins
Genuine conflict with no clear owner    → apply judgment toward what makes sense;
                                          if still unclear, ASK the human.
```

### Reconciliation table (resolved conflicts)

| Topic | Figma Spec said | Planning Prompt said | **Resolved** | Why |
| --- | --- | --- | --- | --- |
| Frontend framework | React 18 + Vite (Figma Make) | Next.js (App Router) | **Next.js (App Router)** | Real deployable app; Figma Make env was a prototype host only |
| Meeting capture | Otter.ai | Recall.ai | **Recall.ai** (hard-locked) | Records + transcribes; single bot per meeting |
| File storage | Google Drive | Cloudflare R2 | **Cloudflare R2** | S3-compatible, zero egress, in-app browser |
| AI provider | ChatGPT / GPT-4 | Claude (sonnet) | **OpenAI first, behind a universal provider interface** | Start OpenAI; swap/add Claude later via dropdown + per-provider auth |
| Email | Gmail auto-send | Resend | **Resend, never auto-send** | Controlled outbound; drafts staged, never sent automatically |
| Documents generated | 5 types | 6 types | **6 types** | Internal vs client email drafts are separate |
| Automations | Make.com | n8n (self-hosted) | **n8n + backend cron** | Backend owns core pipeline; n8n for configurable extras |
| Hosting | Figma Make env | Coolify on VPS | **Coolify on Hetzner CX42** | Self-hosted, full control |
| SSO | Logto + MS SSO | Logto + MS SSO | **Logto now** (MS today, Google/email later) | Abstracts identity for future resale |
| Calendar access | Per-user OAuth connect | Per-user delegated tokens | **App-level Graph `Calendars.Read`, scoped to a security group** | Removes 8-token lifecycle; new hire = add to group |

### Services intentionally NOT in the stack (do not reintroduce)

`Make.com`, `Google Drive`, `Otter.ai`, `tldv`, `Gmail auto-send`, `MinIO`. Each was deliberately replaced. If a task seems to need one of these, escalate instead of reintroducing it.

---

## 4. Locked technical decisions (summary)

Full rationale in `02-tech-decisions.md`. Summary for quick reference:

| Area | Decision |
| --- | --- |
| Frontend | Next.js (App Router), TypeScript, Tailwind v4 |
| Backend topology | Monorepo (pnpm workspaces): `apps/web` (Next.js) + `apps/worker` (Fastify) + `packages/*` |
| Long-running jobs | Fastify worker service + **BullMQ + Redis** |
| Database | Supabase — Postgres + pgvector |
| File storage | Cloudflare R2 (presigned URLs only; never exposed to frontend) |
| Auth | Logto → Microsoft Entra SSO; role claims in JWT; middleware enforcement |
| Calendar | Microsoft Graph, **app-level** permission scoped to a security group |
| Meeting bot | Recall.ai, one bot per deduplicated meeting |
| AI | **OpenAI first**, universal provider interface; embeddings fixed on `text-embedding-3-small` |
| Email | Resend (no auto-send ever) |
| Automations | n8n (self-hosted on Coolify); calls backend API only, never touches DB/R2 directly |
| Real-time | Polling for MVP → Supabase Realtime later |
| VPS | Hetzner CX42 (8 vCPU / 16 GB) |

---

## 5. Three-layer data architecture (the mental model that matters most)

```
Layer 1 — Supabase pgvector    ← what the AI queries (semantic search)
Layer 2 — Cloudflare R2        ← where raw files live (docs, transcripts, uploads)
Layer 3 — In-app file browser  ← what humans see (Next.js, via presigned URLs)
```

**Hard rules:**
- The AI **never** reads from R2 directly. Everything is chunked → embedded → stored in pgvector on ingest.
- The frontend **never** touches R2 directly. All access is via backend-generated **presigned URLs** (15-min expiry).
- R2 credentials live only on the backend, never in the browser.
- Supabase `folders` table is the **permission layer** — R2 stores bytes, Supabase decides who can see them.

---

## 6. Roles (enforced at API middleware, not just UI)

| Role | One-line summary |
| --- | --- |
| **Admin** | Full access: restricted folders, Finance/fee tiers, Settings, pipeline internals, user management, error logs |
| **Standard** | Full working access minus restricted content (no Transcripts folder, no Finance tab, no Settings) |
| **Viewer** | Read-only + can mark **own** assigned tasks complete; all other mutations hidden/blocked |

**Visibility principle:** restricted content is **completely hidden** from unauthorized users (it does not exist in their view) — not merely locked. Enforcement happens on **both** frontend (UX) and backend (security). Full matrix in `02-tech-decisions.md` and `05-api-route-map.md`.

---

## 7. Service glossary

| Service | Role in GA App |
| --- | --- |
| **Next.js** | Frontend + light API routes |
| **Fastify worker** | Long-running pipeline jobs (embedding, AI generation, file writes) |
| **Supabase** | Postgres (structured data) + pgvector (embeddings) |
| **Cloudflare R2** | Raw file storage (S3-compatible, zero egress) |
| **Logto** | Identity abstraction layer in front of Microsoft Entra SSO |
| **Microsoft Graph** | Read team Outlook calendars (app-level, group-scoped) |
| **Recall.ai** | Meeting bot — records + delivers transcript |
| **OpenAI** | Document generation + embeddings (first AI provider) |
| **Resend** | All outbound email (daily sync, alerts) — no auto-send |
| **n8n** | Self-hosted, configurable/custom automations only |
| **BullMQ + Redis** | Job queue for the worker |
| **Coolify** | Self-hosted PaaS on the VPS (deploys containers) |
| **Cloudflare Tunnel** | Secure cloud→server bridge (no open ports) |

---

## 8. Document index

| Doc | Purpose |
| --- | --- |
| `00-overview.md` | This file — synthesis, operating model, conflict resolution |
| `01-architecture.md` | Infrastructure, 3-layer data, n8n boundary, request flow |
| `02-tech-decisions.md` | Every resolved decision with rationale + override line |
| `03-project-structure.md` | Monorepo layout, AI-provider interface, Figma component map |
| `04-database-schema.sql` | Full DDL — tables, enums, indexes, pgvector, RLS |
| `05-api-route-map.md` | Every endpoint, method, auth, role gate, shapes, webhooks |
| `06-ai-pipeline.md` | Prompt chain, both pipelines, provider abstraction |
| `07-integrations.md` | Per-service setup, env vars, webhooks |
| `08-design-system.md` | Colors, typography, tokens, components, all 13 modules |
| `09-build-phases.md` | 10 phases as subagent-ready work packages + delegation briefs |
