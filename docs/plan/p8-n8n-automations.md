# Delegation Brief — P8: n8n & Custom Automations

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §2 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. This gives Gracie a **secure machine-to-machine API surface** so the admin can build custom automations visually in **n8n** — without ever handing n8n the database.
> **Branch + PR for review. Do NOT push to `main`.**

---

## 0. Read first (cold-start context)
- `docs/09-build-phases.md` **Phase 8** (the original P8 brief) · `docs/07-integrations.md` **§8 n8n** + §infra (n8n + n8n-postgres containers) · `docs/01-architecture.md` **§n8n boundary** · `docs/02-tech-decisions.md` **D12–D13**.
- P7 established the **email safety choke-point** (`apps/worker/src/lib/resend.ts` `sendEmail` — allowlist to `@graceandassociates.com`, no processor calls Resend directly). P8 must NOT create a second outbound path around it.
- Existing patterns to mirror: the **machine-auth webhook** `apps/web/app/api/webhooks/recall/route.ts` (non-session, secret-verified); the **web→worker enqueue** pattern `apps/web/app/api/calendar/sync/route.ts` + `/api/daily-sync/run` (P7); session auth `apps/web/lib/api-auth.ts` (`getRequestUser`/`isAdmin`).

## 1. What P8 is — two parts
**Part A (operator / ops — NOT this session):** deploy **n8n + a dedicated n8n-postgres** on Coolify (`N8N_BASIC_AUTH_*`, its own `DB_POSTGRESDB_*`), set the shared **`GA_API_TOKEN`**, and point n8n's workflows at `https://gracie.graceandassociates.com/api/automation/*`. Never give n8n Supabase/R2/MinIO creds. *(Include the exact ops steps in the framework doc — §3.4 — but the deploy itself is the operator's.)*

**Part B (THIS session — code):** the **service-token API surface** n8n calls: token auth, the seed automation endpoints, the sanctioned allowlist-safe outbound path, and the framework documentation. Testable end-to-end with `curl` + the token (n8n itself is exercised by the operator after Part A).

## 2. Hard boundaries (non-negotiable)
- **n8n touches ONLY Gracie's backend API + the AI provider — NEVER Supabase / R2 / MinIO directly** (D13). No DB/storage creds ever go into n8n.
- **All outbound comms stay behind Gracie's ONE allowlist-gated choke-point.** n8n must never send email/SMS to external addresses via its own nodes. The only sanctioned way for an automation to send anything is `POST /api/automation/notify` (§3.3), which routes through the worker's existing `sendEmail` (so `@graceandassociates.com`-only still holds). **Preserves "Gracie cannot reach a customer through any channel."**
- **n8n is strictly OFF the critical path** — no core feature may depend on an n8n workflow running.

## 3. Build (Part B)

### 3.1 Service-token auth
- A shared secret **`GA_API_TOKEN`** (env on the web app; long random; git-ignored — the operator sets the same value in n8n). A helper `requireServiceToken(request): boolean` (constant-time compare of a `Authorization: Bearer <token>` header) — separate from `getRequestUser`/Logto. Missing/bad token → **401**.
- All automation routes live under a NEW namespace **`apps/web/app/api/automation/**`**, `runtime='nodejs'`, gated by `requireServiceToken` first. The token is **admin-equivalent read access** — document that (it's the trust boundary); keep it secret, never log it.

### 3.2 Seed automation endpoints (read/report → JSON)
Reuse existing data layers (don't re-query raw):
- **`GET /api/automation/reports/client-weekly`** (optional `?clientId=`) — per active client: recent meetings, master-record highlights, open/overdue tasks, relationship health + cadence status. Reuse `apps/web/lib/data/client-detail.ts` + `calendar.ts` `listClientCadence`.
- **`GET /api/automation/reports/fee-summary?period=month`** — finance roll-up across clients (`contract_value`, `fee_tier`, billing cadence). ⚠️ Financial data — exposed only because the token is admin-equivalent; document clearly.
- **`POST /api/automation/digest`** (body `{ date? , range? }`) — an ad-hoc digest of activity (mirror the P7 daily-sync **gather** logic in `apps/worker`'s daily-sync processor; extract/share the gather so both use one implementation, or replicate read-only). Returns structured JSON (n8n formats it).

All return JSON; n8n decides what to do with it. Keep them **read-only** (no mutations).

### 3.3 Sanctioned outbound — `POST /api/automation/notify`
- Body `{ subject, html?, text?, recipients? }`. Token-gated. **Enqueues a worker email job** that sends via the existing allowlist-gated `sendEmail` (reuse P7's `sendTeamEmail`/`emailAdminsForAlert` path — do NOT add a new Resend call). Default recipients = all active staff if omitted. The worker's allowlist drops any non-`@graceandassociates.com` recipient exactly as today.
- This is the ONLY outbound path automations get — so n8n never needs email creds and can't reach a customer.

### 3.4 Framework docs
- A `docs/` page (e.g. `docs/12-automations.md`): the token model, the boundary rules (§2), the endpoint catalog (§3.2/3.3), **how the operator deploys n8n + n8n-postgres on Coolify** (env vars, GA_API_TOKEN wiring, the API base URL), **how an admin requests a new automation** (and how a dev adds an endpoint), and **one worked example n8n workflow** (e.g. "Mondays 08:00 ET → call `client-weekly` → format → `POST /api/automation/notify` to the team").

## 4. Out of scope (do NOT build)
- Deploying n8n itself (operator ops — document it, don't do it).
- Building the actual n8n workflows (the admin builds those visually).
- Any n8n access to Supabase/R2/MinIO.
- SMS delivery (that's the **Gracie SMS** add-on — but P8's `/notify` + the P7 notification layer are what it will extend).
- A schema migration — the token is an env var. *(OPTIONAL: a lightweight `automation_runs` audit-log table if you want a record of which automation called when — only if trivial; otherwise skip.)*

## 5. Acceptance (all before the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- `/api/automation/*` returns **401** on missing/invalid `Authorization: Bearer` token and **200** with the valid `GA_API_TOKEN` (verify via `curl`).
- Each report endpoint returns correct JSON against real data; `client-weekly` and `fee-summary` reflect actual clients/finance; `digest` matches the daily-sync gather.
- `POST /api/automation/notify` sends **only** to `@graceandassociates.com` (it rides the P7 allowlist choke-point — the existing 7/7 allowlist tests still pass; add one covering the enqueue path).
- The `docs/12-automations.md` framework doc exists, incl. the operator's n8n-on-Coolify deploy steps + one example workflow.
- Branch + **PR for review** (not `main`); `git status` shows no secrets staged (`GA_API_TOKEN` lives only in git-ignored env).

## 6. Escalate (stop + ask the orchestrator) if
- An automation genuinely needs data the API can't expose without giving n8n DB access (don't cross the boundary — escalate).
- The fee-summary financial exposure via a single shared token needs a tighter model than "admin-equivalent token."
- Any outbound requirement can't be satisfied through `/api/automation/notify` + the allowlist (e.g. it needs SMS — that's the Gracie SMS add-on, not P8).
- Sharing the daily-sync gather logic would force a change to the P7 daily-sync processor's contract.

---

### FLAGS for the operator (defaults chosen; confirm/adjust)
1. **Seed automations:** brief covers all three (client-weekly, fee-summary, ad-hoc digest). OK, or start with a subset?
2. **Outbound safety:** automations send ONLY via `/api/automation/notify` (allowlist-gated) — recommended; n8n gets no email creds. Confirm you don't want n8n emailing directly.
3. **n8n infra:** is n8n already deployed on Coolify, or does the operator stand it up as part of this? (End-to-end testing needs it; Part B is testable via curl without it.)
4. **Token storage:** `GA_API_TOKEN` as a plain env var (simple) vs. a rotatable stored credential. Defaulted to env.
