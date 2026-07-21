# Delegation Brief — P9: Settings / Admin / Scoring (finish the admin surface)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §1 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. **This is a FINISHING phase** — most of Settings/Admin already shipped across P1–P8. P9 surfaces the remaining **SQL-only config** as admin UI, builds the **scoring-config editor** + the **pipeline error-log / manual re-trigger**, and cleans up loose ends. **No new agentic surface, no email changes, no responsive/nav work** (that is the separate RL phase).
> **Branch + PR for review. Do NOT push to `main`.** Build in the order in §1.2; each step green-gates independently.

---

## 0. Read first (cold-start context)
- `docs/09-build-phases.md` §"Phase 9" — the original (broad) goal. **The orchestrator has narrowed it** — see §1.1 for what is IN vs. explicitly OUT.
- The app: Next.js app-router web app in `apps/web`, BullMQ worker in `apps/worker`, shared code in `packages/shared`, DB types + migrations in `packages/db`. One self-hosted Supabase (dev+prod shared). Roles: **admin / standard / viewer**.
- **The whole Settings area is admin-only** and already exists. You are extending it, not creating it.
- Config convention: app config lives in the `settings` table as **`(key, value)`** where `value` is JSON-encoded, usually a **string** — written `to_jsonb('...'::text)` and read as `typeof value === 'string' ? value : null` then parsed. Booleans are the strings `'true'`/`'false'`. Match this exactly (mirrors 0004/0005/0009/0010 + `p7_settings.sql`).

### 0.1 Where to touch (mapped by the orchestrator — trust, then verify)
| Concern | File(s) |
|---|---|
| Settings page (5 CollapsibleSections today) | `apps/web/app/(app)/settings/page.tsx` |
| Existing settings panels (COPY these as templates) | `apps/web/app/(app)/settings/{UsersPanel,BotSettingsPanel,NotificationSettingsPanel,AutomationsSettingsPanel,ApiSettingsPanel}.tsx` |
| Settings data modules (the pattern) | `apps/web/lib/data/notification-settings.ts` (booleans as JSON strings), `apps/web/lib/data/bot-config.ts`, `apps/web/lib/data/automations.ts` (`getAutomationsMinIntervalMinutes`) |
| Settings API routes (the pattern) | `apps/web/app/api/settings/{notifications,automations,bot}/route.ts` — all `getRequestUser()` + `isAdmin()` gated |
| Reusable UI | `apps/web/components/ui/CollapsibleSection.tsx`, `apps/web/components/ui/ToggleSwitch.tsx` |
| Auth gates | `apps/web/lib/api-auth.ts` (`getRequestUser`, `isAdmin`, `isEditor`); `apps/web/lib/auth.ts` (`useAuth().can(...)`) |
| Permissions model | `packages/shared/src/constants/permissions.ts` (`PERMISSIONS`, `PERMISSION_MATRIX`, `can`) |
| **Scoring** — pure calc + config type | `packages/shared/src/types/health.ts` (`HealthConfig`, signal keys `cadenceAdherence`/`meetingRecency`/`openOverdueTasks`/`completionRate`, `computeHealth`, `deriveTrend`) |
| **Scoring** — worker recompute (reads config) | `apps/worker/src/processors/relationship-health.processor.ts` (reads `settings.relationship_health_config`) + its queue |
| **Scoring** — config default + schema | `packages/db/migrations/0007_relationship_health.sql` (default weights cadence 45 / recency 20 / tasks 20 / completion 15) |
| **Scoring** — per-signal admin override (already built; DON'T rebuild) | `apps/web/components/client/HealthCard.tsx` + `apps/web/lib/data/client-health.ts` (`POST/DELETE /api/clients/[clientId]/health`) |
| Web→worker enqueue (recompute after save) | `apps/web/lib/queue.ts` (find the relationship-health producer used by client/task/note edits) |
| **Pipeline** page (self-defers error log + manual trigger) | `apps/web/app/(app)/pipeline/page.tsx` |
| Pipeline data | `pipeline_runs` table; generation queue producer (reuse for re-trigger) — see how P5b/P7 enqueue generation |
| AI provider/model config | `packages/db/src/ai.ts` (`ai_model`, reserved `ai_provider`, `getActiveProvider`); `apps/web/app/(app)/settings/ApiSettingsPanel.tsx` |
| `ga_company_description` readers | `apps/worker/src/processors/generate.processor.ts`, `apps/web/lib/.../chat-retrieval.ts`, assistant prompt |
| `internal_email_domains` readers | `apps/worker/src/processors/calendar-scan.processor.ts`, `contact-suggestions.processor.ts`, `apps/web/lib/data/calendar.ts` |
| Migrations + DB types | `packages/db/migrations/` (latest **`0010`**). **Likely NO new migration** — see §5. If one is truly needed, add **`0011`** + hand-regen `packages/db/src/database.types.ts` (no `supabase` CLI in env). |

### 1. Locked decisions (operator + orchestrator)
1. **Scope = the "focused" path** (§1.1). Config-to-UI + scoring-config editor + pipeline admin + cleanup. The deeper data-model items are **backlog, not P9**.
2. **Fee-tier is NOT a scoring signal.** Keep the shipped 4-signal algorithm (cadence/recency/tasks/completion) exactly. `fee_tier` stays a finance/display field. Do **not** touch the health algorithm's signal set. (Sentiment signal also stays deferred.)
3. **Calendar controls stay on the Calendar page.** Do NOT move the bot-dispatch / manual-join kill-switches or the connection panel into Settings. Leave `apps/web/app/(app)/calendar/page.tsx` structurally alone.
4. **No responsive / mobile / nav work.** The collapsible-sticky sidebar + full responsive layout are the **separate RL phase** (next after P9). Do not touch `apps/web/components/Sidebar.tsx` or `apps/web/app/(app)/layout.tsx` for layout/responsiveness.
5. **Everything new is admin-only**, gated on read AND write (route: `getRequestUser()` + `isAdmin()` → 403 for non-admin; UI behind `can('settings.access')`). Viewer/standard must not read or write any of it.

### 1.1 IN vs. OUT
**IN (build these):**
- **A. Config-to-UI** — surface SQL-only settings as admin controls (§2).
- **B. Scoring config editor** — edit `relationship_health_config` weights/thresholds, then recompute (§3).
- **C. Pipeline admin** — error-log view + manual re-trigger (§4).
- **D. Cleanup** — orphaned `calendar.configure` permission + stale comments (§6).

**OUT (explicitly deferred — do NOT build; the orchestrator will backlog them):**
- Fee-tier as a scoring signal; sentiment signal.
- Client **aliases** management, **meeting-type rules**, a **fee-tier assignment** page, **KB tag** management (the never-built endpoints from `docs/05`).
- Consolidating calendar controls into Settings.
- All responsive/mobile/collapsible-nav work (RL phase).
- Widening the `email_allowed_domains` allowlist from the UI (stays read-only — escalation-only, by design).

### 1.2 Build order (each step green-gates independently; a partial PR is fine)
1. **Scoring config editor** (§3) — the headline; self-contained (new panel + data module + route + recompute enqueue).
2. **Config-to-UI panels** (§2) — Company Settings panel + fold the stragglers into existing panels + AI model selector.
3. **Pipeline admin** (§4) — error log, then manual re-trigger.
4. **Cleanup** (§6).

---

## 2. Config-to-UI (make SQL-only settings admin-editable)

All admin-only. Reuse `CollapsibleSection` + `ToggleSwitch` + the `notification-settings.ts`/route pattern (data module → `GET/PATCH /api/settings/<x>` → panel with auto-save or explicit Save). Store values as JSON strings to match existing readers.

**2.1 New "Company Settings" panel** (`CompanySettingsPanel.tsx` + `lib/data/company-settings.ts` + `GET/PATCH /api/settings/company`):
- `ga_company_description` — a textarea (used by the AI Assistant + generation prompts). This is the primary company-identity setting; ship it for sure.
- `internal_email_domains` — a comma-separated / chip editor of internal domains (feeds calendar matching + contact suggestions). Validate: non-empty, lowercased, no free-email providers. **Note:** the GA floor domain(s) should not be removable to zero — keep at least one. This is read by the worker at scan time; no worker change needed (it already reads the key).
- **Business hours + brief lead times** — the original goal lists these. **Business hours is currently hardcoded** in `calendar-scan.processor.ts` (the Mon–Fri 7–19 ET scan gate). Making it a setting means the WORKER must read a new key. **Decision: include ONLY if low-effort** — if wiring the worker to read a `business_hours` setting is clean, add it; otherwise **defer business hours + brief-lead-times** to backlog and note it in the PR. Do not block the panel on them. (`ga_company_description` + `internal_email_domains` are the must-haves here.)

**2.2 Extend "Automations" panel** — add a control for `automations_min_interval_minutes` (the recurring-interval floor, default 60). Read/write via the existing automations settings route (extend it). Validate ≥ the structural floor (5) and a sane max (e.g. ≤ 10080 / weekly). Sits next to the external-send master switch.

**2.3 Extend "Notifications" panel** — add timing/threshold controls:
- `daily_sync_hour_et` (0–23) — the hour the daily-sync email fires.
- `kb_expiry_warning_days` (int, sane bounds) — KB-expiry lead time.
- `at_risk_health_threshold` (0–100) — the health score that flags a client "at risk" in the daily sync.
Extend `notification-settings.ts` + its route; keep the existing read-only `email_allowed_domains` display as-is.

**2.4 AI provider/model selection** — add to **API Settings** (or a small new "AI" panel). Read `ai_model` (+ reserved `ai_provider`) from `packages/db/src/ai.ts`. Provide a **selector of allowed chat models** (define the allowed list in shared code — do NOT free-text a model id). The **embeddings model is shown read-only/pinned** (changing it would invalidate existing vectors — surface a warning, do not allow it here). Route: `GET /api/settings/ai` (current + options) + `PATCH /api/settings/ai` (admin). Confirm `getActiveProvider`/callers pick up the new `ai_model` on next request (no restart).

---

## 3. Scoring config editor (the "Scoring" headline)

Make the relationship-health **algorithm config** admin-tunable from the app (today it's edit-the-jsonb-by-hand).

- New **"Scoring" panel** (`ScoringSettingsPanel.tsx` + `lib/data/scoring-settings.ts` + `GET/PATCH /api/settings/scoring`, admin-only).
- Edit the fields of `settings.relationship_health_config` — the 4 signal **weights** (cadenceAdherence / meetingRecency / openOverdueTasks / completionRate) + the thresholds/params that config already contains (cadence intervals, recency-days, overdue penalties, trend params). **Read the exact shape from `packages/shared/src/types/health.ts` (`HealthConfig`) + the `0007` default — edit those fields, do not invent new ones.** (No fee-tier/sentiment — locked §1.2.)
- **Validation:** weights are non-negative; show the live normalized split (the algorithm renormalizes, so weights need not sum to 100, but surface the effective %). Reject nonsense (all-zero weights, out-of-range thresholds).
- **On save → enqueue a full relationship-health recompute** (the sweep variant, not per-client) so new weights take effect immediately instead of waiting for the nightly run. Reuse the existing relationship-health queue producer (`lib/queue.ts`). Surface "recomputing…" feedback.
- **Do NOT rebuild** the per-signal per-client override (`HealthCard` + `/api/clients/[id]/health`) — that's shipped and stays. This panel is the *global config*, that is the *per-client override*.
- Add a `scoring.configure` permission (admin-only) OR reuse `settings.access` — prefer a dedicated `scoring.configure` in `permissions.ts` for clarity (admin tier), gate the route + panel on it.

---

## 4. Pipeline admin (declared-but-unbuilt)

The permissions `pipeline.viewErrors` + `pipeline.triggerManual` exist but are wired to nothing; `apps/web/app/(app)/pipeline/page.tsx:10` self-defers. Build both, admin-only.

**4.1 Error log** (`pipeline.viewErrors`): an admin view of failed/needs-attention `pipeline_runs` — meeting, stage, error detail, timestamp. Read via a new `lib/data/pipeline.ts` (or extend existing pipeline data) + `GET /api/pipeline/runs?status=failed` (admin). Render on the Pipeline page (a new admin-only section), reusing existing table/list styling.

**4.2 Manual re-trigger** (`pipeline.triggerManual`): let an admin re-run generation for a failed meeting. **Reuse the existing generation queue producer** (the same one P5b/the webhook uses) — enqueue a generation job for the meeting; do NOT write a new pipeline. `POST /api/pipeline/[meetingId]/retrigger` (admin, `pipeline.triggerManual`). Guard against double-fire (disable the button while in-flight; the generation processor is idempotent per meeting — verify). Confirm the master **bot kill-switch is unrelated and untouched**.

---

## 5. Data model — expect NO migration

- **2.1–2.4, 3, 4 are almost entirely new `settings` KEYS + reuse of existing tables** (`pipeline_runs`, `relationship_health_config` from 0007, `ai_model`). New settings keys need only **idempotent seed rows** (`insert … on conflict do nothing`) in a NON-numbered seed file (e.g. `packages/db/seeds/p9_settings.sql`) — most readers already default when a key is absent, so seeds are optional-but-tidy.
- **Add a numbered migration `0011` ONLY if** you introduce a genuinely new column/table (e.g. if business-hours needs structured storage). Default assumption: **none needed.** If you add `0011`, keep it additive + idempotent (0009/0010 style) and hand-regen `database.types.ts`; **coordinate with the orchestrator to apply it** (do not apply it yourself).
- New permissions (`scoring.configure`, and any you wire) go in `packages/shared/src/constants/permissions.ts` — no DB change (roles are code-driven via `PERMISSION_MATRIX`).

---

## 6. Cleanup
- **`calendar.configure`** permission is declared but orphaned (calendar controls use `hasRole('admin')` directly). **Wire it:** replace the direct `hasRole('admin')` checks on the calendar admin controls (`BotDispatchToggle`, manual-join switch, connection admin view, ambiguous-assignment) with `can('calendar.configure')` / an `isAdmin`-equivalent that reads the permission. Keep behavior identical (it's admin-tier). If wiring is risky, **remove** the permission instead — do not leave it orphaned.
- Delete the stale deferral comments: `settings/page.tsx:19-20` ("company settings / calendar automation / user management arrive in later phases") and `pipeline/page.tsx:10` ("wire up in a later phase") — replaced by real features.

---

## 7. Gate + safety (must pass before PR)
- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`. (`/daily-sync` static-prerender needs the LAN DB — if the build's only failure is that one page's DB read, note it; it builds on Coolify. Prefer adding `export const dynamic = 'force-dynamic'` to any NEW server page that reads the DB.)
- **Security:** every new route rejects non-admin on read AND write (403) — add/adjust a quick check; a viewer or standard user must not read or mutate scoring/company/AI/pipeline config via any path. Confirm the panels don't render for non-admin (they won't reach the page, but defense-in-depth).
- **No secrets staged** (`.env.local` is gitignored — verify nothing new is committed).
- **Kill-switches untouched** (`calendar_bot_dispatch_enabled`, `manual_join_enabled`, `automations_external_send_enabled` all stay at their current values; you only add a *control*, you do not flip them).
- **No email/agentic behavior change** — you are not touching the send choke-point or the Assistant tools.
- Idempotent seeds only (if any). If you added `0011`, it's additive + you did NOT apply it.

## 8. PR notes to include
- List every new `settings` key + its default + where it's read.
- State clearly: migration added? (expected: no) — if yes, which objects, and that it's unapplied pending orchestrator.
- New permissions added + what they gate.
- Which OUT items you touched adjacent to (should be none).
- Confirm business-hours/brief-lead-times: included or deferred (§2.1).
- Green-gate result + the non-admin 403 check result.
