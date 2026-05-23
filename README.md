# Gracie

**Grace & Associates Meeting Intelligence System.**

Internal platform for an 8-person federal healthcare IT consulting firm. Automates client meeting capture, AI-driven document generation, task tracking, and team alignment.

> **Status: planning.** No production code yet. The repo currently contains specs and implementation plans only.

---

## Where to start

Everything begins in `docs/`.

- **`AGENTS.md`** at the repo root — instructions for any AI assistant working on this project.
- **`docs/_context/STATE.md`** — live project state. Read this first if you're picking up cold.
- **`docs/_context/DECISIONS.md`** — every locked architectural decision with rationale.
- **`docs/_context/STACK.md`** — the resolved tech stack.
- **`docs/specs/v1-backend.md`** — canonical spec for backend, data, pipeline, integrations.
- **`docs/specs/figma-frontend.md`** — canonical spec for design system, UI, component anatomy.
- **`docs/plan/`** — implementation plans, one per subsystem, executed in numeric order.

---

## High-level shape (locked so far)

- **Frontend:** Next.js (App Router) + React 18 + TypeScript + Tailwind v4
- **Backend:** Fastify (separate container) + TypeScript
- **Queue:** BullMQ + Redis
- **DB:** Supabase Postgres + pgvector
- **Storage:** Cloudflare R2
- **Auth:** Logto + Microsoft SSO
- **AI:** Claude (claude-sonnet-4-5) for generation; embedding model TBD
- **Meeting capture:** Recall.ai
- **Calendar:** Microsoft Graph
- **Email:** Resend
- **Automations:** n8n on Coolify
- **Deploy:** Coolify on a VPS, Cloudflare Tunnel for ingress

Full stack with status flags is in `docs/_context/STACK.md`.
