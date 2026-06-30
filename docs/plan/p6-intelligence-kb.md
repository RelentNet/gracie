# Delegation Brief — P6: Intelligence Chat & Knowledge Base

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Depends on P5 (done & merged, `715dc68`):
> the AI provider interface, `getEmbedder`/`getActiveProvider`, `match_embeddings`, and a
> populated `embeddings` table are all live. Build ON them.

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current state (infra up; P5a+P5b done; web/worker env reconstructed).
- `docs/06-ai-pipeline.md` — **§1 provider interface, §7 Intelligence chat retrieval flow** (THE spec for this phase).
- `docs/05-api-route-map.md` — **`POST /api/ai/chat`** (line ~127) + **Knowledge Base routes** (lines ~157–160).
- `docs/08-design-system.md` — **tab 7 Intelligence** (line ~145: scope bar, bubbles slate-100 left / blue-600 right, markdown, Enter-to-send) + **M9 Knowledge Base** (line ~129: table, filters, upload modal).
- `docs/04-database-schema.sql` — `embeddings`, `knowledge_base_documents`, the `match_embeddings` function (line ~668), enum `embedding_source` (`'knowledge_base'`).
- `docs/02-tech-decisions.md` — **D9** (pinned embedder), **D11** (provider interface), **D14** (role gating).

### Existing code to BUILD ON / reuse (do NOT duplicate)
- `@gracie/db` — `getEmbedder()` (pinned query embedding), `getActiveProvider()` (generation provider+model), `getServerClient()`.
- `@gracie/shared` provider interface — **`provider.stream(input)` already streams tokens** (`openai.adapter.ts`); use it for chat.
- `apps/worker` — the **ingest pipeline** (`processors/ingest.processor.ts`, `lib/{extract,chunk}.ts`, `queues/ingest.queue.ts`): the KB embedding job mirrors it exactly (extract → chunk → embed → insert `embeddings`).
- `apps/web/lib/data/files.ts` + `app/api/files/*` — the presign/store + **role-gating** pattern (restricted folders / transcript visibility). The chat's role filter mirrors this.
- `apps/web/lib/api-auth.ts` `getRequestUser()` — returns the user + role (mock identities in dev).
- `match_embeddings(query_embedding, match_client_id, match_count)` RPC — returns `{id, source_type, source_id, content, similarity}`.

## Global rules (non-negotiable)
- **AI ONLY through the provider interface** — query embedding via `getEmbedder()`, chat via `getActiveProvider().provider.stream(...)`. NEVER the OpenAI SDK. Embeddings pinned 1536-dim (D9).
- **Role-filtered retrieval is a SECURITY requirement, not a nicety** (see §Scope 1). Get it right and verify it.
- **Frontend never touches MinIO** — presigned URLs / server receipt only.
- Keep `@gracie/shared` client-safe (no Node/bullmq). Never reintroduce removed services.
- **Never commit secrets** (`git check-ignore` before `git add`; env files + `docs/SECRETS.md` git-ignored).
- Verify before claiming done; match codebase style (strict TS, `.js` specifiers, JSDoc); loading/error/empty states on every component.

## Env (ALREADY RECONSTRUCTED + verified — do not regenerate)
Both `apps/worker/.env.local` and `apps/web/.env.local` are in place and validated against live infra (Supabase, MinIO `ga-app-dev`, Redis-with-auth, OpenAI). **`apps/web/.env.local` deliberately OMITS `LOGTO_*` → the app uses MOCK auth in dev** (`lib/auth-shared.ts`), so you can switch between admin / standard / viewer to test the role filter. If you work in a fresh git worktree, copy both env files in first:
`cp /Users/phoenix/code/gracie/apps/worker/.env.local apps/worker/.env.local` and the same for `apps/web`.
Next.js auto-loads `apps/web/.env.local`; the worker reads it via `--env-file-if-exists`.

## Scope — build this

### 1. Chat retrieval + `POST /api/ai/chat` (the core)
A web route (`runtime='nodejs'`), **any role**, body `{ clientId, message, includeKnowledgeBase }`, that **streams** the answer (docs/06 §7):
1. `getRequestUser()` → role; authorize the user can see `clientId`.
2. Embed the query (`getEmbedder()`).
3. **Client retrieval:** `match_embeddings(queryVec, clientId, K*2)` — **over-fetch** (e.g. 2×) because of the next step.
4. **ROLE FILTER (critical):** drop any chunk whose `source_type='transcript'` when the user is **not admin** — transcripts are Admin-only (mirror the restricted-folder rule, D14). Then trim to top-K. Over-fetching avoids returning too few after the drop. *(Never pass `match_client_id=null` — that leaks every client's chunks.)*
5. **KB retrieval (only when `includeKnowledgeBase`):** KB chunks have `client_id=null`, so `match_embeddings(clientId)` EXCLUDES them. Retrieve them separately — chunks where `source_type='knowledge_base'` whose parent `knowledge_base_documents.ai_active=true` (similarity-ranked). This needs a **new** query/RPC (see §Escalate); merge a few KB chunks into the context.
6. Assemble the prompt: GA company description (`settings.ga_company_description`) + client description + the retrieved chunks + recent chat history; stream via `provider.stream(...)`. Markdown (incl. **bold**) preserved.

### 2. Intelligence tab UI (M2A tab 7, `docs/08` line ~145)
Scope bar ("Scoped to [Client]"), a **Knowledge Base toggle**, a chat thread (**AI bubbles left in slate-100, user bubbles right in blue-600**, markdown bold rendered), a textarea + Send, **Enter = send / Shift+Enter = newline**, streaming token render, and loading/error/empty states. Wire it into the existing client-profile tab shell.

### 3. Knowledge Base module (M9)
- **Routes** (`docs/05`): `GET /api/knowledge-base?search=&tags=&status=` (any); `POST` (editor → store file + insert `knowledge_base_documents` + **enqueue a KB embedding job**); `PATCH /:id` (editor → edit metadata / archive by toggling `ai_active`); `DELETE /:id` (admin).
- **KB embedding job** (`apps/worker`): mirror the ingest processor — fetch object → extract → chunk → `getEmbedder()` → insert `embeddings` with `source_type='knowledge_base'`, `source_id=<kb id>`, `client_id=null`. Idempotent re-runs (clear prior by source first).
- **UI (M9):** table (title, topic chips, type, uploaded, **status + expiry badges**), filters (search / tags / status), an **upload modal** (title, file, tags, description, expiration, AI-active toggle), and archive (toggle `ai_active`). Loading/error/empty states.

## Out of scope (DO NOT build — later phases)
- The **Assistant module** (general AI chat / Module 14) — that's **P6B**, a separate brief.
- **Web search / "Online Research" toggle** — explicit fast-follow, not now.
- Pre-meeting briefs / daily sync / notifications digest (P7); any `.docx` rendering.

## Acceptance (all must pass before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- Asking a **client-scoped** question returns a **streamed** answer grounded in that client's documents (P5 already populated `embeddings` for seeded clients — e.g. the CMS meeting transcript + generated docs).
- Toggling **Knowledge Base** on injects KB context (upload a KB doc, confirm its content can be retrieved into an answer).
- A KB doc can be **uploaded → embedded → archived** (archive flips `ai_active=false` and it stops being retrieved).
- **ROLE FILTER VERIFIED:** as a mock **standard/viewer**, a question whose best matches are transcript chunks returns an answer with **no transcript-sourced context**; as **admin**, the same query DOES use them. (Switch roles via the dev mock identities.)
- Branch + **PR for review** (do NOT push to `main`); `git status` shows no secrets staged.

## Escalate (stop + ask the orchestrator) if
- Cleanly retrieving **"this client's chunks + global KB chunks (ai_active)"** needs a schema change: adding a **new** RPC (e.g. `match_kb_embeddings`) or a migration is fine — note it in the PR — **but do NOT modify the shipped `match_embeddings` signature** or the provider interface without asking.
- The chat prompt should reuse the doc-generation `assemblePrompt` (5-layer) vs a chat-specific assembly is ambiguous — pick the chat-specific one and note it, or ask.
- Role-filtering can't be enforced at retrieval for some `source_type` you find in the data — stop; this is the security gate and must not ship loose.
