# 05 — API Route Map

> Every endpoint: method, path, auth, role gate, request/response shape.
> Auth column legend: **Any** = any authenticated user · **Editor** = admin or standard · **Admin** = admin only · **Owner** = resource owner (special-cased).
> Restricted content is **omitted from responses** for unauthorized roles (not returned-and-hidden).

**Conventions**
- All routes require a valid Logto JWT unless marked Public.
- Long-running work returns `202 Accepted` + enqueues a BullMQ job; clients poll for status.
- Errors: `{ error: { code, message } }`. Validation via zod (`packages/shared/schemas`).
- Base path for app API: `/api`. Worker exposes internal-only endpoints (not public).

---

## Auth & session

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/auth/login` | Public | Redirect to Logto |
| GET | `/api/auth/callback` | Public | Logto callback; upsert `users` row on first login |
| POST | `/api/auth/logout` | Any | Clear session |
| GET | `/api/auth/me` | Any | Current user `{ id, name, email, role, initials, calendarConnected }` |

---

## Dashboard

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | Any | Aggregated: today's meetings, tasks due/overdue, needs-attention alerts, KB-expiry alert, daily-sync preview. Polled every 60s. Viewer gets read-only shape. |

---

## Clients

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/clients` | Any | List clients. `fee_tier`/`contract_value` **omitted** unless Admin. |
| GET | `/api/clients/:id` | Any | Client detail (header + overview data). |
| POST | `/api/clients` | Admin | Create client. |
| PATCH | `/api/clients/:id` | Editor | Update editable fields (description, contact). Fee/contract fields Admin-only. |
| DELETE | `/api/clients/:id` | Admin | Delete client. |
| GET | `/api/clients/:id/strategy` | Any | Strategy tab: trajectory, risk flags, master-record entries. |
| GET | `/api/clients/:id/finance` | **Admin** | Finance tab. 403 for others; tab hidden in UI. |
| GET | `/api/clients/:id/operations` | Any | Tasks (scoped), pipeline runs, transcript history. |
| GET | `/api/clients/:id/master-record` | Any | Full chronological master record. |

---

## Client notes (Notes tab)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/clients/:id/notes` | Any | Note feed (author chip, timestamp, content). |
| POST | `/api/clients/:id/notes` | Editor | Add note. |
| PATCH | `/api/notes/:noteId` | Owner/Admin | Edit own note (admin any). |
| DELETE | `/api/notes/:noteId` | Owner/Admin | Delete own note (admin any). |

---

## Files & folders (R2 via presigned URLs)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/folders?clientId=` | Any | Folder tree. **Restricted folders omitted** unless role ∈ allowed_roles. |
| POST | `/api/folders` | Editor | Create folder. `visibility:'restricted'` → Admin only. |
| PATCH | `/api/folders/:id` | Editor | Rename / set visibility (visibility change Admin-only). |
| DELETE | `/api/folders/:id` | Admin | Delete folder. |
| GET | `/api/documents?clientId=&type=&status=&source=` | Any | Document list (global or client). Docs in hidden folders omitted. |
| GET | `/api/files/url?key=&action=get\|put` | Any (get) / Editor (put) | **Issue presigned URL.** Backend authorizes the folder path against `folders` first. 15-min expiry. |
| POST | `/api/files/move` | Editor | `{ sourceKey, destinationKey }` → R2 copy+delete → update `documents.r2_key`. |
| PATCH | `/api/documents/:id` | Editor | Rename / change status / acknowledge review. |
| DELETE | `/api/documents/:id` | Owner/Admin | Delete (standard: own only; admin: any). |
| POST | `/api/documents/:id/stage-draft` | Editor | Client Email Draft → create Outlook draft via Graph. **Never sends.** Blocked until review acknowledged. |

---

## Upload (Module 3)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/upload` | Editor | Create document record(s) + enqueue ingest/generation. Body: `{ clientId, files:[{ key, documentType, meetingType?, context?, outputPrompt? }] }`. Returns `202` + `pipelineRunId`. |

---

## Tasks (Module 6)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/tasks?clientId=&owner=&status=&priority=&archived=` | Any | Cross-client or scoped task list. |
| POST | `/api/tasks` | Editor | Create task. |
| PATCH | `/api/tasks/:id` | Editor / Owner(viewer) | Editor: any field. **Viewer: only `status` on own task.** |
| POST | `/api/tasks/:id/complete` | Any (own) | Mark complete — Viewer allowed only if owner. |
| POST | `/api/tasks/:id/archive` | Editor | Archive. |
| GET | `/api/tasks/:id/notes` | Any | Task note feed. |
| POST | `/api/tasks/:id/notes` | Editor | Add task note. |

---

## Calendar (Module 7)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/calendar?from=&to=` | Any | Meetings in range (grid + day detail). |
| GET | `/api/calendar/connections` | Any | Team calendar-connection status (= access-group membership). Admin sees all; user sees own. |
| GET | `/api/calendar/ambiguous` | Admin | Meetings needing manual client assignment. |
| POST | `/api/calendar/assign` | Admin | `{ meetingId, clientId }` resolve ambiguous meeting. |
| GET | `/api/calendar/cadence` | Any | Per-client cadence tracker (last/next/overdue). |

---

## Pipeline (Module 4)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/pipeline?status=&clientId=&from=&to=` | Any | Meeting pipeline table (live status). Polled every 30s. |
| GET | `/api/pipeline/history` | Any | Completed pipeline runs. |
| GET | `/api/pipeline/errors` | **Admin** | Error log (`error_message`). 403 for others. |
| POST | `/api/pipeline/run` | Admin | Manual trigger for a meeting/uploaded file → `202`. |

---

## AI chat (Intelligence tab)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/ai/chat` | Any | `{ clientId, message, includeKnowledgeBase }`. Embeds query → pgvector retrieval (client-scoped, role-filtered) → provider via interface → **streams** response. Uses the currently selected provider/model. |

---

## Knowledge Base (Module 9)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/knowledge-base?search=&tags=&status=` | Any | KB document list. |
| POST | `/api/knowledge-base` | Editor | Add KB doc (+ enqueue embedding). Body: title, key, tags, description, expiration, aiActive. |
| PATCH | `/api/knowledge-base/:id` | Editor | Edit metadata / archive (toggle `ai_active`). |
| DELETE | `/api/knowledge-base/:id` | Admin | Delete. |

---

## Daily Sync (Module 8)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/daily-sync?date=` | Any | Today's (or given date's) sync. |

---

## Notifications

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/notifications` | Any | Own notifications. |
| POST | `/api/notifications/:id/read` | Any (own) | Mark read. |

---

## Settings (Module 12 — Admin only)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/settings` | Admin | All global settings (company description, business hours, lead times, AI model). |
| PATCH | `/api/settings` | Admin | Update settings keys. |
| GET | `/api/settings/users` | Admin | User management table. |
| PATCH | `/api/settings/users/:id` | Admin | Change role / details. |
| POST | `/api/settings/users` | Admin | Add user. |
| GET | `/api/settings/aliases` | Admin | Client aliases. |
| POST/DELETE | `/api/settings/aliases` | Admin | Manage aliases. |
| GET | `/api/settings/meeting-rules` | Admin | Keyword→type rules. |
| POST/DELETE | `/api/settings/meeting-rules` | Admin | Manage rules. |
| GET | `/api/settings/fee-tiers` | Admin | Per-client fee tier assignment. |
| PATCH | `/api/settings/fee-tiers/:clientId` | Admin | Set fee tier. |
| GET | `/api/settings/kb-tags` | Admin | KB topic tag management. |
| POST/DELETE | `/api/settings/kb-tags` | Admin | Manage tags. |

---

## API Settings — integration credentials (Admin only) ⭐ NEW

> Backs the **Admin → API Settings** page. ALL third-party API keys are editable here.
> **The raw secret is NEVER returned to the client** — only `isSet` + last-test status.
> Secrets are stored encrypted (`integration_credentials.secret_encrypted`).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/settings/integrations` | **Admin** | List all integrations with `{ service, label, isSet, config, lastTestedAt, lastTestOk }`. **No secret values.** |
| PUT | `/api/settings/integrations/:service` | **Admin** | Set/replace a key. Body: `{ secret?, config? }`. Encrypts `secret`, sets `is_set=true`. Returns status only. |
| DELETE | `/api/settings/integrations/:service` | **Admin** | Remove stored secret (falls back to env var). |
| POST | `/api/settings/integrations/:service/test` | **Admin** | "Test Connection" — performs a lightweight live call (e.g. Recall ping, OpenAI models list). Stores `last_tested_at`/`last_test_ok`. Returns `{ ok, message }`. |

**Provider/model selection (AI-specific, also Admin):**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/settings/ai-providers` | Admin | List configured providers + available models + which is active. |
| PATCH | `/api/settings/ai` | Admin | Set active `{ provider, model }` (writes `settings.ai_provider`/`ai_model`). Embeddings remain pinned (D9). |

**Credential resolution at runtime** (backend helper, used everywhere):
```
getCredential(service):
  1. read integration_credentials row for service
  2. if is_set → decrypt secret_encrypted → return
  3. else → return process.env[ENV_VAR_FOR(service)]   (fallback)
  4. short in-memory cache; invalidate on PUT/DELETE
```
This means a key changed in API Settings takes effect immediately, and env vars are the default until overridden.

---

## Webhooks

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/webhooks/recall` | Signature-verified | Recall.ai "transcript ready" → verify `bot_job_id` → enqueue pipeline job → `202`. |
| POST | `/api/webhooks/logto` | Signature-verified | (Optional) user/role sync events from Logto. |

---

## Internal worker endpoints (NOT public; called by cron/queue only)

| Trigger | Action |
| --- | --- |
| Calendar scan (cron) | Graph scan → match → dedup → upsert meetings |
| Bot dispatch (cron) | Dispatch Recall bot ≤5 min before start |
| Transcript watchdog | 90-min window → else `needs_attention` + Resend alert |
| Pipeline job | Ingest → generate 6 docs → extract tasks → store → notify |
| Daily sync (cron) | 5:45 gather → 6:00 generate + Resend |
| Pre-meeting brief (cron) | Generate brief at lead time |

n8n calls **public backend API endpoints** above (never the DB/R2 directly, D13).

---

## Middleware contract (applied to every `/api` route)

```ts
// illustrative
const { userId, role } = verifyLogtoJWT(req);          // 401 if missing/invalid
if (route.requireAdmin && role !== 'admin') return 403;
if (route.requireEditor && !['admin','standard'].includes(role)) return 403;
req.user = { userId, role };
// handler then does resource-level checks (folder visibility, task ownership)
// and relies on Supabase RLS as defense-in-depth.
```
