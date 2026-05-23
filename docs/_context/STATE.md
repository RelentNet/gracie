# GA App — Live State

> **This file is the entry point for every new session.** Read it first.
> Update it at the END of every session — what you did, what's next, anything blocking.

---

## Current Phase

**Planning** — gathering decisions and producing per-phase implementation plans in `docs/plan/`.
**No production code has been written.** Repo only contains specs and planning artifacts.

---

## Last Session Summary

**Date:** 2026-05-23
**Did:**
- Created the repo at `github.com/RelentNet/gracie` (public, RelentNet org).
- Initialized local git, set `main` as default branch.
- Read both source specs (v1 backend + Figma frontend).
- Reconciled the two — locked policy: v1 wins on backend/data/pipeline; Figma wins on design/UI.
- Set up cross-session context files: this `STATE.md`, `DECISIONS.md`, `STACK.md`, `GLOSSARY.md`.
- Wrote `AGENTS.md` at repo root so future sessions auto-load context.
- Resolved **Batch 1 decisions** (backend structure, job queue, language) — see DECISIONS.md.
- Began **Batch 2** (Logto hosting, embeddings, parallelism, extraction scope) — interrupted before answers.

**Did NOT:**
- No code written.
- No `package.json`, no Next.js scaffold, no schema yet.
- Specs are not yet copied into `docs/specs/` (currently in `~/Downloads/` and `~/Desktop/`).

---

## Next Action (start here next session)

1. Copy the two source specs into `docs/specs/`:
   - `/home/phoenix/Downloads/GA_App_ClaudeCode_Prompt_v1.md` → `docs/specs/v1-backend.md`
   - `/home/phoenix/Desktop/GA App/DOWNLOAD_THIS.md` → `docs/specs/figma-frontend.md`
2. Resume **Batch 2 decisions** (see Open Questions below) — ask the user the four open questions.
3. After Batch 2: Batch 3 (real-time updates, VPS sizing, n8n DB).
4. After all decisions locked: produce `docs/plan/00-foundation.md` (writing-plans skill format).

---

## Open Questions — must be resolved before plans are written

These are the v1 spec's 10 "Open Technical Decisions". Status as of this session:

### Resolved (see DECISIONS.md)
- [x] Backend structure → Fastify, separate container
- [x] Job queue → BullMQ + Redis
- [x] Backend language → Node.js / TypeScript

### Pending — ask the user

- [ ] **Logto hosting** — Cloud (recommended) vs self-hosted on Coolify
- [ ] **Embedding model** — OpenAI text-embedding-3-small vs Voyage AI vs local
- [ ] **Document generation parallelism** — concurrent with p-limit(3) (recommended) vs sequential vs fully parallel
- [ ] **Text extraction scope at launch** — text formats only (recommended) vs +Whisper audio vs +vision
- [ ] **Real-time pipeline updates** — polling (recommended for MVP) vs WebSockets vs Supabase Realtime
- [ ] **VPS sizing** — Hetzner CX32 vs CX42 vs DO equivalent; what's the budget ceiling?
- [ ] **n8n Postgres** — share Supabase vs separate container on Coolify

### Reconciliation conflicts between Figma and v1 (need user adjudication)

- [ ] **"Online Research" toggle on Intelligence tab** (Figma only). In scope or drop?
- [ ] **In-app user provisioning vs Logto-first** — Figma shows "Add User" + role dropdown applied immediately; v1 says role comes from Logto. Which flow?
- [ ] **"Join Meeting" button on Calendar** (Figma only) — display Teams/Zoom URL on meeting cards. Confirm in scope.
- [ ] **Master Record surface** — dedicated route reachable from Strategy tab, or inline-only? Figma implies a full page.

---

## Working Policy (locked at session 1)

- v1 backend spec wins on backend / data / pipeline / integrations.
- Figma spec wins on design system / typography / color / component anatomy.
- Where both touch the same surface, merge: v1's data shape + Figma's presentation.
- Every Figma-only feature is flagged explicitly so it can be deferred per phase.

---

## Notes / Watch Items

- Per global AGENTS.md "Lessons Learned": **never gate runtime behavior on `request.url.hostname`** — Coolify/Traefik forwards internal host. Use `import.meta.env.PROD` or `X-Forwarded-Host`.
- Recall.ai webhook reliability — design for 90-min watchdog (per v1 spec § Calendar Integration / Post-Meeting Monitoring).
- pgvector index strategy not yet decided (ivfflat vs hnsw). Defer to schema plan.
- `requires_review = true` is a HARD rule for Client Summary + Client Email Draft. Never auto-send.
