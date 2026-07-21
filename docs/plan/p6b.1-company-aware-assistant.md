# Delegation Brief — P6B.1: Company-aware Assistant (read-only, role-mirrored platform access)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §2 (security) first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Builds on the merged **P6B Assistant** (general per-user chat)
> and reuses the **P6 Intelligence** retrieval + role gates. Live in prod.
> **SECURITY-SENSITIVE. Branch + open a PR for review — do NOT push to `main`.**

## 0. The ask (operator's words, authoritative)
Today the **Assistant tab** (`/assistant`, P6B) can only see files the user attaches to a chat — it has NO
company data (confirmed: `apps/web/lib/assistant/prompt.ts` — *"NO client/KB retrieval and NO embeddings"*).
Company knowledge lives only in the **Intelligence tab** (P6), which is **client-scoped** (you must pick one
client) with an optional KB toggle. So the operator can't ask a general assistant *"how many clients do we have"*
(≈9) or *"summarize our latest KB memo"* (the memo IS embedded — 1 KB doc, 7 chunks — but only reachable from a
client's Intelligence chat).

**Decision:** make the **Assistant** company-aware. It should be able to answer from **all information on the
platform the asking user is allowed to see**, both **knowledge** ("summarize the memo") and **structured facts**
("how many clients", "which clients are overdue"). It is **strictly read-only** — it must never change settings or
mutate anything.

## 1. Scope in one line
Give the general Assistant a **read-only, role-mirrored** company brain: (A) cross-client **retrieval** over the
Knowledge Base + client documents + transcripts, and (B) **structured read tools** over clients/tasks/meetings —
every path gated to exactly what the **asking user** could already see in the app.

## 2. SECURITY MODEL — the heart of this feature (get this exactly right)
**Access = a mirror of the asking user's own in-app permissions. Never more.** Resolve the caller's role via
`getRequestUser()` (`apps/web/lib/api-auth.ts` — role is DB-authoritative from `users.role` after PR #11) and gate
EVERY retrieval result and EVERY tool result with the SAME authorities the app already uses:

- **Restricted / admin-only folders** — reuse the folder-visibility gate. Non-admins must never receive chunks or
  documents from a `folders.visibility='restricted'` folder that excludes their role. Authority:
  `filterChunksByFolderVisibility` (`apps/web/lib/data/chat-retrieval.ts`) + `isVisibleToRole`
  (`apps/web/lib/data/documents.ts`). Admins keep their existing access.
- **Transcripts** — non-admins never receive `source_type='transcript'` chunks. Authority: `filterChunksForRole`
  (`@gracie/shared`), already used by Intelligence.
- **Admin-only client fields** — `clients.fee_tier` and `clients.contract_value` are admin-only. Structured tools
  must redact these for non-admins (match however `apps/web/lib/data/clients.ts` already gates them).
- **HARD OFF-LIMITS to everyone (no path, no role):**
  - `settings` table (read AND write) — never expose, never change.
  - `integration_credentials` (OpenAI/Recall API keys) — never expose.
  - **Other users' private Assistant data** — `assistant_chats` / `assistant_messages` / `assistant_attachments`
    for any user ≠ the caller. P6B's per-user privacy stays intact; the assistant reads only the caller's own chat.
- **READ-ONLY.** Every tool is a SELECT. NO tool writes, changes settings, dispatches bots, or mutates any row.
- **Prompt-injection posture:** because everything is read-only and role-scoped to the caller, a malicious document
  can't make the model exfiltrate data the caller couldn't already see — but keep tool inputs constrained (no
  free-form SQL; typed filters only) and never let retrieved text change which role/user the gates use.

**The single source of truth for "what can this caller see" must be centralized** (one role-gating module the
retrieval path and every tool call through), not re-implemented per tool. A viewer must not be able to extract an
admin-only folder doc, a transcript, or a fee tier through ANY assistant path.

## 3. Build — (A) cross-client retrieval
Today's Intelligence retrieval (`retrieveContext` in `chat-retrieval.ts`) is **client-scoped**: it calls
`match_embeddings(match_client_id, …)` and explicitly warns that a NULL client id *"would leak every client's
chunks"*. For a company-wide assistant you need cross-client retrieval that is **gated after fetch**:
1. **Migration `0006`**: add an RPC `match_all_embeddings(match_count int, query_embedding vector)` that returns
   the same shape as `match_embeddings` **plus `client_id` and `source_type`** across ALL client embeddings
   (exclude KB — KB has its own `match_kb_embeddings`). Mirror `match_embeddings`/`match_kb_embeddings` style.
2. Over-fetch a candidate pool, then apply `filterChunksForRole` + `filterChunksByFolderVisibility` for the
   caller's role, then trim to top-K. Merge KB chunks via the existing `match_kb_embeddings` (global, `ai_active`
   only). This reuses the exact gates Intelligence uses — do NOT invent a new gate.
3. Feed the surviving chunks into the Assistant turn as grounded context (with lightweight source labels).

## 4. Build — (B) structured read tools (tool-calling)
Structured/aggregate questions ("how many clients", "clients overdue for a QBR", "meetings this week") can't be
answered by RAG — they need typed read tools. **First check whether the pinned `AIProvider` interface
(`@gracie/shared`, used by `provider.stream`/`generate`) supports tool/function calling.** If it doesn't, adding
it (OpenAI tool-use: advertise tools → model emits tool_calls → execute server-side → feed results back → continue
streaming) is part of this work — **but if that's a large lift, ESCALATE to the orchestrator** with options before
committing to it.

Implement a small set of **read-only, role-gated** tools (typed args, no free-form SQL), e.g.:
- `count_clients(filter?)`, `list_clients(filter?)` — role-redacts `fee_tier`/`contract_value` for non-admins.
- `get_client(nameOrId)` — summary (name, description, cadence, health/trend; financials admin-only).
- `list_tasks(filter)` (status/overdue/by-client), `list_meetings(filter)` (upcoming/past/by-client).
- `list_knowledge_base(order_by='recent')` — so "the **latest** memo" resolves by `created_at`, not just semantic
  similarity, then hand the doc to retrieval/summary. (Recency questions are why pure RAG feels blind here.)
- `search_knowledge_base(query)` / `search_documents(query)` — thin wrappers over the §3 retrieval (role-gated).

Every tool receives the caller's `{ userId, role }` and gates through the §2 central module. Read-only.

## 5. Build — (C) the assistant loop + prompt
- Keep P6B's per-user chat model intact (`user_id = self`, admin purge still works, attachments still injected).
- Make company-awareness **automatic/agentic** (no per-query toggle): the model decides when to retrieve/call tools.
- Update `ASSISTANT_SYSTEM_PROMPT` (`lib/assistant/prompt.ts`): it now HAS read access to company knowledge + tools,
  is **read-only**, must ground answers in retrieved/tool data and cite what it used, and must say "I don't have
  access to that" rather than guess when a gate hides something. Include a real company description — read
  `settings.ga_company_description` if present (currently unset → falls back), don't hardcode a new one.
- Preserve streaming + auto-title + token estimate.

## 6. Reuse (do NOT rebuild)
- Gates: `filterChunksForRole` (`@gracie/shared`), `filterChunksByFolderVisibility` + `retrieveContext` patterns
  (`apps/web/lib/data/chat-retrieval.ts`), `isVisibleToRole` (`apps/web/lib/data/documents.ts`).
- Auth/role: `getRequestUser()` (`apps/web/lib/api-auth.ts`), the assistant user resolver (`apps/web/lib/assistant/user.ts`).
- Assistant plumbing: `apps/web/app/api/assistant/chat/route.ts`, `lib/assistant/prompt.ts`, the shared
  `components/chat` UI, the `AIProvider` interface + embedder (`getEmbedder`, `@gracie/db`).
- RPCs: `match_kb_embeddings`, `match_embeddings` (as the template for `match_all_embeddings`).

## 7. Out of scope
- ANY write/mutation/tool that changes data; anything touching `settings`, bot dispatch, or the calendar
  (kill-switch `calendar_bot_dispatch_enabled` stays **OFF**, untouched).
- Changing the Intelligence tab's behavior (only reuse its helpers).
- Web browsing; cross-user data in the assistant; new admin analytics. Merging the two chat surfaces.

## 8. Env / rules
- `cp /Users/phoenix/code/gracie/apps/worker/.env.local <worktree>/apps/worker/.env.local`. Never commit secrets
  (`git check-ignore` before `git add`; env + `docs/SECRETS.md` git-ignored).
- Apply migration `0006` to the shared dev+prod Supabase via postgres-meta `POST {SUPABASE_URL}/pg/query` (key from
  `apps/worker/.env.local`) — CONFIRM WITH THE ORCHESTRATOR first (dev+prod share one DB); if the LAN link
  `10.200.200.131:8001` times out, hand it to the orchestrator.
- Strict TS, `.js` import specifiers, JSDoc; loading/error/empty states.

## 9. Acceptance (all before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- In the Assistant tab: *"how many clients do we have?"* → correct count (≈9); *"summarize our latest KB memo"* →
  grounded summary of the actual latest KB doc.
- **Security tests (required, the crux)** — prove the mirror model by flipping `MOCK_ROLE` (as P6B's privacy tests
  do): a **viewer/standard** user CANNOT get, via ANY assistant path (retrieval OR tool), (a) content from an
  admin-only/restricted folder, (b) a meeting transcript, or (c) `fee_tier`/`contract_value`; an **admin** can.
  No path returns `settings`, API keys, or another user's assistant chats. No tool can write.
- Branch + **PR for review** (not `main`); `git status` shows no secrets. Call out the access-control module + the
  `match_all_embeddings` RPC in the PR description for the orchestrator's security review.

## 10. Escalate (stop + ask the orchestrator) if
- The `AIProvider` interface lacks tool/function calling and adding it is a large architectural change — present
  options (full tool-calling vs. a hybrid: inject a role-scoped platform-facts summary + retrieval) before building.
- The centralized role gate can't cleanly cover a data source you want to expose (don't ship a half-gated path).
- Applying `0006` / the RPC's row-security is ambiguous, or `/pg/query` is unreachable (orchestrator applies it).
- Anything would require a WRITE capability or exposing `settings`/credentials/other users' data to satisfy a request.
