# Delegation Brief — P6B: Assistant Module (general AI chat, ChatGPT replacement)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Builds on P6 (done & merged): the AI provider
> `stream()`, the Intelligence chat UI, and the streaming route pattern all exist — REUSE them.
> This is a "thin layer on the existing AI stack" (spec §3): 3 tables (already in schema) + a
> module + routes. **No new AI plumbing.**

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current state (P1–P6 done; Microsoft SSO live; web/worker env reconstructed).
- `docs/superpowers/specs/2026-06-07-assistant-module-design.md` — **THE full spec** (read entirely: §4 data flow, §5 data model, §6 routes, §7 UI, §8 errors, §9 testing, §11 out-of-scope).
- `docs/04-database-schema.sql` — `assistant_chats` / `assistant_messages` / `assistant_attachments` (lines ~404–438), `users.deactivated_at` (line ~125), enum `assistant_msg_role`.
- `docs/05-api-route-map.md` — Assistant routes (lines ~139–148) + the file-Q&A note.
- `docs/08-design-system.md` — §M14 Assistant (ChatGPT-style two-pane, native to the portal).

### Existing code to REUSE (do NOT rebuild — "native to Gracie" is the whole point)
- **Streaming route pattern:** `apps/web/app/api/ai/chat/route.ts` — `ReadableStream` + `getActiveProvider().provider.stream(...)` (never the OpenAI SDK). `/api/assistant/chat` mirrors this.
- **Chat UI:** `apps/web/app/(app)/clients/[clientId]/intelligence/page.tsx` — the bubbles (assistant left slate-100 / user right blue-600), markdown, streaming render, Enter/Shift+Enter. **Extract the reusable chat-thread pieces into a shared component** and use them in both the Intelligence tab and `/assistant` so they stay identical.
- **Provider/model:** `getActiveProvider()` from `@gracie/db` (active model from API Settings; users don't choose).
- **Auth:** `getRequestUser()` (`apps/web/lib/api-auth.ts`) — dev uses MOCK identities, so you can switch users to test privacy isolation.
- **Text extraction:** `apps/worker/src/lib/extract.ts` (mammoth/pdf-parse/papaparse). It's worker-only today — **promote the extraction helper to a shared location** (e.g. a small `packages/shared`-safe module or a web lib) so the web attachment route can extract synchronously. No embeddings for the Assistant (spec §3).
- **Storage:** `@gracie/shared/storage` `putObject`/presign for optional raw-file retention (`assistant_attachments.r2_key`).

## Global rules (non-negotiable)
- **PRIVACY IS THE SECURITY GATE.** Assistant data is strictly per-user; **admins NEVER read content** (only purge). The app uses the **service-role** Supabase client, which **BYPASSES RLS** — so *every* route MUST enforce `user_id = <current user>` in its own query logic. That app-layer check is the real gate; add the RLS policies too as defense-in-depth.
- **AI ONLY through the provider interface** (`provider.stream()` / `getActiveProvider`); never the OpenAI SDK.
- Attachments are **chat-scoped & ephemeral** — never mixed with client documents / KB / embeddings.
- Frontend never touches MinIO; keep `@gracie/shared` client-safe. Never reintroduce removed services.
- **Never commit secrets** (`git check-ignore` before `git add`; env files + `docs/SECRETS.md` git-ignored).
- Verify before claiming done; strict TS, `.js` specifiers, JSDoc; loading/error/empty states on every component.

## Env (ALREADY RECONSTRUCTED + verified — do not regenerate)
`apps/web/.env.local` + `apps/worker/.env.local` are in place and validated (Supabase, MinIO `ga-app-dev`, Redis, OpenAI). Web uses **MOCK auth** in dev (`LOGTO_*` omitted) → switch mock identities to test that user A can't see user B's chats and that an admin can't read content. In a fresh worktree, copy both env files in first (`cp /Users/phoenix/code/gracie/apps/web/.env.local apps/web/.env.local`, same for worker).

## Scope — build this (spec §5–§7)
1. **Schema check:** confirm `assistant_chats/messages/attachments` + `users.deactivated_at` + `assistant_msg_role` exist in the **live** DB (they're in `docs/04`; the base schema was migrated). If any `assistant_*` **RLS policies** are missing, add them via a migration (mirror P6's `packages/db/migrations/0002…`): `user_id = auth_uid()` for select/insert/update/delete, **no admin read exception**.
2. **Routes** (`apps/web/app/api/assistant/*`, `runtime='nodejs'`, all auth, all enforce `user_id = self`):
   - `GET /chats` (my list) · `POST /chats` (new) · `GET /chats/:id` · `PATCH /chats/:id` (rename/archive) · `DELETE /chats/:id` — each verifies the chat's `user_id` = caller.
   - `POST /chat` `{ chatId?, message, attachmentIds? }` → load history (`assistant_messages` for chatId, ownership-checked) → if attachments, read `extracted_text` (ownership-checked) and prepend to context → `provider.stream()` with the active model → **stream tokens** → persist the user + assistant messages → **auto-title** the chat on the first exchange → record `token_usage` from the provider result.
   - `POST /attachments` — accept a file (editor path not required; all roles), extract text (promoted extractor), store `assistant_attachments` (`extracted_text`, `user_id`, `chat_id`, optional MinIO `r2_key`). Size/type guard with a clear message.
   - `DELETE /api/settings/users/:id/assistant-data` — **Admin-only purge** (delete-only, service-role): delete all `assistant_chats` (cascades messages/attachments) for that user; set `users.deactivated_at`. **Never selects/returns content.**
3. **UI** (`/assistant`, new **sidebar item for ALL roles**) — ChatGPT-style two-pane using the shared chat components: left = conversation list (auto-title, search, new-chat, archive/delete); right = streaming thread (bubbles as above, markdown, Enter/Shift+Enter) + input with **file-attach**. Loading/error/empty states; no placeholder content.

## Out of scope (DO NOT build — spec §11)
- **Web search / live browsing** (explicit fast-follow). Image generation, voice, code-execution, custom GPTs.
- Persistent personal file library (attachments stay chat-scoped/ephemeral). Sharing chats between users.
- Embeddings/pgvector for attachments (inject extracted text directly; chunk+truncate if oversized).
- Cost/billing dashboards (just record `token_usage` per message; reporting is P9/P10).

## Acceptance (all must pass before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- A user can hold **multiple private conversations** with **streaming + auto-titles**; history persists.
- **PRIVACY VERIFIED:** as mock user B, you **cannot** read user A's chats via the API; as **admin**, you cannot read any user's chat *content* — only the purge succeeds. (Switch mock identities to prove it.)
- **File Q&A:** upload a `.txt`/`.pdf` → ask about it → grounded answer; the attachment is chat-scoped (not visible in client docs/KB, not embedded).
- **Offboarding:** the admin purge deletes ALL of a user's assistant data (chats/messages/attachments) and sets `deactivated_at`.
- Changing the active model in **API Settings** is reflected in **new** chats.
- Branch + **PR for review** (do NOT push to `main`); `git status` shows no secrets staged.

## Escalate (stop + ask the orchestrator) if
- Promoting `extract.ts` to a shared location would force a change to the shipped **worker ingest** processor or the provider interface — factor the shared helper without touching those; ask if that's not possible.
- The `assistant_*` tables/RLS are **absent** from the live DB (unexpected) — adding a migration is fine; note it in the PR, but confirm before altering any existing table.
- The auto-title approach (a small extra provider call vs. a heuristic from the first message) is ambiguous — pick the cheap heuristic or a single short titling call and note it.
- Anything would weaken the per-user privacy guarantee (e.g. a route that could return another user's content) — stop; this is the security gate and must not ship loose.
