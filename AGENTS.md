# GA App — Agent Instructions

**Project:** Grace & Associates Meeting Intelligence System
**Repo:** github.com/RelentNet/gracie
**Status:** Planning phase. No production code yet.

---

## Read these first, in this order

Any new session MUST read these before touching anything else:

1. `docs/_context/STATE.md` — Live status, current task, open questions, what was last done
2. `docs/_context/DECISIONS.md` — Every locked architectural decision with rationale
3. `docs/_context/STACK.md` — Resolved tech stack (do not re-litigate items here)
4. `docs/_context/GLOSSARY.md` — Project-specific terms

The two source-of-truth specs are:

- `docs/specs/v1-backend.md` — Canonical spec for backend, data, pipeline, integrations
- `docs/specs/figma-frontend.md` — Frontend/design spec (Figma session output)

When the specs conflict, **`v1-backend.md` wins** on backend/data/pipeline/integrations.
**`figma-frontend.md` wins** on design system, color, typography, component anatomy.

---

## Working rules for this project

1. **Update `STATE.md` at the end of every session** — what you did, what's next, any new open questions. This is non-negotiable; it is how the next session starts cold.
2. **Lock decisions into `DECISIONS.md` as soon as the user confirms them.** Include the date, the question, the chosen option, and a one-line rationale. Never re-ask a locked decision.
3. **Do not invent stack items.** If it's not in `STACK.md`, it's not in the stack. Ask before adding.
4. **Plans live in `docs/plan/`** as `NN-<subsystem>.md` (e.g., `00-foundation.md`, `01-client-files.md`). They follow the `writing-plans` skill format.
5. **Skills are mandatory.** Process skills (brainstorming, debugging, writing-plans, TDD, verification-before-completion) override defaults. See `~/.config/opencode/AGENTS.md` for the global rules.

---

## Project-specific stack overrides

(Authoritative copy lives in `docs/_context/STACK.md`. This is a 5-second skim.)

- Frontend: **Next.js (App Router) + React 18 + TypeScript + Tailwind v4**
- Backend: **Fastify (separate container) + TypeScript**
- Queue: **BullMQ + Redis**
- DB: **Supabase Postgres + pgvector**
- Storage: **Cloudflare R2** (S3-compatible)
- Auth: **Logto + Microsoft SSO**
- AI: **Claude API (claude-sonnet-4-5)** for generation
- Embeddings: **TBD** — see open decisions in `STATE.md`
- Email: **Resend**
- Meeting bot: **Recall.ai**
- Calendar: **Microsoft Graph API**
- Automations: **n8n** (self-hosted on Coolify, custom automations only)
- Deploy: **Coolify on Hetzner/DO VPS**, **Cloudflare Tunnel** for ingress
- Typography: **IBM Plex Sans 400/500/600/700 + IBM Plex Mono 400/500**

---

## Anti-patterns specific to this project

- **Do not reintroduce these (explicitly removed by v1 spec):** Make.com, Google Drive, Otter.ai, tldv, Gmail auto-send, MinIO, OpenAI ChatGPT for document generation.
- **Do not auto-send client-facing content** under any circumstance. Client Summary and Client Email Draft are always `requires_review = true`.
- **Do not expose R2 credentials to the frontend.** All R2 access is via presigned URLs minted by the backend after role check.
- **Do not check roles only in the UI.** Every API route enforces role via middleware. UI hiding is presentation, not security.
- **Do not gate runtime behavior on `request.url.hostname`** (see global AGENTS.md — Coolify/Traefik forwards internal host).

---

## When in doubt

- Ask the user. Cheaper than building the wrong thing.
- Skill-check before acting (per global AGENTS.md / using-superpowers).
- Update STATE.md before ending the session.
