# GA App — Resolved Tech Stack

> Single source of truth for what's in the stack.
> Adding anything new requires user confirmation — log it in DECISIONS.md and update this file in the same change.

Legend: ✅ locked · 🟡 leaning but pending confirmation · ❓ open decision

---

## Application

| Layer | Choice | Status | Notes |
|------|------|------|------|
| Frontend framework | Next.js (App Router) | ✅ | React 18, TypeScript |
| Frontend styling | Tailwind CSS v4 | ✅ | Per Figma spec |
| Frontend typography | IBM Plex Sans (400/500/600/700) + IBM Plex Mono (400/500) | ✅ | Self-host via `next/font` |
| Frontend icons | Lucide React | ✅ | Per Figma spec |
| Backend framework | Fastify | ✅ | Decision [002] |
| Backend language | Node.js + TypeScript | ✅ | Decision [004] |
| Monorepo tooling | TBD — pnpm + turbo (leaning) | 🟡 | Decide when scaffolding |
| Job queue | BullMQ | ✅ | Decision [003] |
| In-memory store | Redis (Coolify container) | ✅ | For BullMQ |

## Data

| Layer | Choice | Status | Notes |
|------|------|------|------|
| Primary DB | Supabase Postgres | ✅ | Managed |
| Vector search | pgvector (on Supabase) | ✅ | Index strategy TBD: ivfflat vs hnsw |
| File storage | Cloudflare R2 (S3-compatible) | ✅ | Zero egress fees |
| Embedding model | OpenAI text-embedding-3-small / Voyage AI / local | ❓ | Pending Batch 2 |

## Identity & external APIs

| Layer | Choice | Status | Notes |
|------|------|------|------|
| Auth provider | Logto + Microsoft SSO (OAuth 2.0) | ✅ | Hosting model open |
| Logto hosting | Cloud vs self-hosted on Coolify | ❓ | Pending Batch 2 |
| LLM | Claude API (claude-sonnet-4-5) | ✅ | Switchable in Settings |
| Calendar | Microsoft Graph API | ✅ | Read-only team calendars |
| Meeting bot | Recall.ai | ✅ | One bot per deduplicated meeting |
| Email (outbound) | Resend | ✅ | All SMTP |
| Custom automations | n8n (self-hosted on Coolify) | ✅ | Configurable automations only |
| n8n Postgres | Share Supabase vs separate container | ❓ | Pending Batch 3 |

## Infrastructure

| Layer | Choice | Status | Notes |
|------|------|------|------|
| Container orchestration | Coolify | ✅ | On a VPS |
| VPS | Hetzner CX32 / CX42 (or DO equivalent) | ❓ | Pending Batch 3 |
| Ingress | Cloudflare Tunnel | ✅ | No open ports on VPS |
| TLS / DNS | Cloudflare | ✅ | Via Tunnel |
| Real-time strategy | Polling vs WS vs Supabase Realtime | ❓ | Pending Batch 3 |

## Anti-stack (explicitly NOT in scope — do not reintroduce)

- Make.com (replaced by backend + n8n)
- Google Drive (replaced by R2 + in-app browser)
- Otter.ai (replaced by Recall.ai)
- tldv (replaced by Recall.ai)
- Gmail auto-send (replaced by Resend; also no auto-send rule)
- MinIO (archived April 2026; R2 replaces)
- OpenAI ChatGPT / GPT-4 for document generation (Claude only)
- Vercel deploy (we self-host on Coolify)
