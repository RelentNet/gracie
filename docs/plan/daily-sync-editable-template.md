# Delegation Brief — DS: Editable Daily-Sync Template + optional AI brief

> Self-contained brief for a fresh Claude Code session. Read §0 + §6 first.
> **Platform:** macOS, Node 24, pnpm. Web `apps/web`, worker `apps/worker`, shared `packages/shared`, DB `packages/db`.
> **Branch + PR. Do NOT push to `main`.** Config-to-UI + one grounded LLM step — mirror the PE pattern (`docs/plan/pe-editable-generation-prompts.md`, shipped as #60). Reuse existing infra; invent nothing new.

---

## 0. What + where
Admins edit, from the dashboard (no deploy), **the 6 AM daily-sync email** — its structure (a template with shortcodes) and, optionally, a **single AI-composed narrative** dropped into that structure via a shortcode. The morning email is deterministic today; the whole point is: **keep deterministic structure, add optional AI smarts inside it, grounded only in our own data.**

Current pieces (all in the worker):
- `apps/worker/src/lib/email-templates/daily-sync.ts` → `renderDailySyncEmail(input)` builds the email in code: `Good morning` + `Yesterday` (statRow) + `Today's meetings` (ul) + `Clients to watch` (ul) + `Pre-meeting briefs` (per-meeting boxes) + an `Open Daily Sync` button. **This is the templatize target.** It uses HTML helpers from `./layout.ts` (`h2`, `p`, `muted`, `ul`, `statRow`, `box`, `preText`, `button`, `renderEmailLayout`, `escapeHtml`) — keep using them.
- `apps/worker/src/lib/brief.ts` → `buildBriefContent` assembles each per-meeting deterministic brief (health, attendees, recent history from `master_record_entries`, recent meetings, open tasks). **Transcript-derived summaries + tasks — this is the grounding data the AI brief reuses.** Leave it deterministic; it stays the `{pre_meeting_briefs}` shortcode.
- `apps/worker/src/processors/daily-sync.processor.ts` → the run: assembles `DailySyncContent`, renders, sends one email per active staffer via `sendTeamEmail` (allowlist-gated). Has a manual `source='manual'` path (bypasses gate) — reuse it for preview/test-send.
- `packages/shared/src/types/daily-sync.ts` → `DailySyncContent` (`yesterday`, `todayMeetings`, `atRiskClients`, `briefs`). Add an optional `aiBrief: string | null` field.
- Settings today (worker reads via `apps/worker/src/lib/notify-config.ts`): `daily_sync_enabled`, `daily_sync_hour_et`, `pre_meeting_briefs_enabled`, `at_risk_health_threshold` (+ `kb_expiry_warning_days`, which is NOT brief-specific → leave in Notifications).
- Web settings surface for those: `apps/web/lib/data/notification-settings.ts` (key map) + `apps/web/app/(app)/settings/NotificationSettingsPanel.tsx`.

## 1. The template engine (lazy — no templating dep)
Split the email into **fixed HTML shell** (locked chrome, never user-editable) + **editable body template** (text + shortcodes). Non-technical staff never touch raw HTML — the operability line (see §6).

- Keep `renderEmailLayout(...)` as the fixed shell (header/footer/styling/footnote). Only the **body** becomes template-driven.
- **Refactor `renderDailySyncEmail`**: extract each section into a per-shortcode renderer in a `SHORTCODE_RENDERERS: Record<Shortcode, { html(content): string; text(content): string }>` map, reusing the existing layout helpers. Then `renderTemplate(template, content)`:
  - a line that is exactly a lone `{shortcode}` → that renderer's HTML block (heading + content, matching today);
  - any other line → literal text, `escapeHtml`'d and wrapped with `p()` (so free text between sections is safe);
  - unknown `{shortcode}` → render the literal token (visible, so a typo is obvious — never silently dropped).
- **The default template string reproduces today's email byte-for-byte** (same shortcodes, same order) so the no-config path is unchanged. Put it + the shortcode registry in `@gracie/shared` (single source for the worker renderer keys AND the web reference list).
- The plain-text alternative renders through the same map's `text(content)` — one template drives both.
- **Blank/whitespace template → fall back to the default** (never send a blank email).

**Shortcode registry** (`@gracie/shared`, e.g. `ai/daily-sync-template.ts`) — `{ code, label, description }[]`:
`{recipient_name}`, `{sync_date}`, `{yesterday_activity}`, `{todays_meetings}`, `{at_risk_clients}`, `{pre_meeting_briefs}` (existing deterministic per-meeting briefs), `{last_week_todos}` (**new** deterministic: firm-wide open tasks created or due in the last 7 days), `{ai_brief}` (§2), `{open_daily_sync_button}`.

## 2. The AI brief shortcode (`{ai_brief}`) — grounded, optional, safe
One firm-wide LLM narrative, off by default, that ties the morning together — **fed ONLY our assembled facts, no web, no invention.**

- In `daily-sync.processor.ts`, after `DailySyncContent` is assembled (+ the new last-week-todos gather): if `daily_sync_ai_brief_enabled` AND a provider resolves, compose ONE narrative:
  - **Source content = a deterministic text assembly of the same facts** already computed (today's meetings + the per-meeting `briefs` content + at-risk + yesterday + last-week todos). The model sees nothing else.
  - Reuse `getActiveProvider()` (@gracie/db) + `assemblePrompt` (@gracie/shared): `documentInstruction` = the editable AI-brief prompt; `sourceContent` = the assembled facts. **No web/fetch tool is in this path** (that's Assistant-only) — grounding is structural, not just prompt-instructed.
  - The default AI-brief prompt leads with the hard rule: *"Use ONLY the information provided below. Do not add outside knowledge, and never invent facts. Wrap anything uncertain in [VERIFY: …]."* Internal-staff audience only.
  - Store the result on `content.aiBrief`; `{ai_brief}` renders it in a `box`. Toggle off or `aiBrief === null` → renders empty.
- **Reliability floor:** wrap the compose in `try/catch` — any failure (provider down, timeout, error) logs a warning and leaves `aiBrief = null`. **The 6 AM email always sends** (deterministic). One firm-wide call per run, only when the toggle is on (cost/latency stay negligible).

## 3. New settings keys + defaults + API (mirror PE)
- **New keys** (jsonb `settings.value`, no migration): `daily_sync_email_template` (string), `daily_sync_ai_brief_prompt` (string), `daily_sync_ai_brief_enabled` (bool). Worker tolerates all absent → default template, default prompt, AI off.
- **Defaults live in `@gracie/shared`** (`DEFAULT_DAILY_SYNC_TEMPLATE`, `DEFAULT_AI_BRIEF_PROMPT`, `DAILY_SYNC_SHORTCODES`) — worker falls back to them, web shows them. Add a `resolveDailySyncTemplate(override)` helper (blank → default), unit-testable like PE's `resolveGenerationPrompts`.
- **New route** `GET/PATCH /api/settings/daily-sync` + `lib/data/daily-sync-settings.ts` — admin-gated (`isAdmin` on both, exactly like `app/api/settings/generation-prompts/route.ts`). GET returns `{ template: {default, effective}, aiPrompt: {default, effective}, aiEnabled, shortcodes }`. PATCH sets/clears template + prompt (blank/equal-to-default → drop) and the toggle.
- The **4 consolidated toggles/fields** (`daily_sync_enabled`, `pre_meeting_briefs_enabled`, `daily_sync_hour_et`, `at_risk_health_threshold`) keep their existing keys and existing `/api/settings/notifications` reader/writer — the new panel just **reads/writes them through that same endpoint** (no ownership move, worker untouched). Only the UI relocates.

## 4. Web UI — new "Daily Sync" tab
_(User leaned "Pre-Meeting Briefs" as the tab label; it edits the whole morning email, so "Daily Sync" is more accurate — trivial label choice, confirm with them.)_

New `DailySyncSettingsPanel` in Settings (`can('settings.access')`, admin), added as a **new tab** in `app/(app)/settings/page.tsx` (the tabbed nav shipped in #60 — just add one `TabItem`). Sections, top to bottom:
1. **Consolidated controls** — the 4 toggles/fields moved out of Notifications (daily-sync on/off, pre-meeting-briefs on/off, send hour ET, at-risk threshold), via `/api/settings/notifications`. **Remove those rows from `NotificationSettingsPanel`** (keep the admin-alert toggles, `kb_expiry_warning_days`, and the read-only allowlist there).
2. **Email template** — a textarea prefilled with the **effective** template, a **shortcode reference list** beside/under it (from `DAILY_SYNC_SHORTCODES`: code + what it inserts), and **Reset to default**. Mirror `GenerationPromptsPanel`.
3. **AI brief** — an **on/off switch** + a textarea for the AI-brief prompt (effective, Reset to default) + the `{ai_brief}` shortcode shown for copy-in. A note: *"Composed only from your own meeting data — Gracie never uses outside information here."*
4. **"Send test email to me"** button (see §5).

On save, if the template contains an **unknown shortcode**, warn (list them) but allow — Reset is the escape hatch (mirror PE's `task_checklist` warning treatment).

## 5. Preview / test-send (operability — "see it work")
Editing a template that goes to the whole team at 6 AM is a footgun without a preview. Reuse the manual path:
- Extend `app/api/daily-sync/run/route.ts` (or add `/api/settings/daily-sync/preview`) with a **"test to me"** mode: render the email with the **saved** template + prompt + toggle against today's real (or most-recent) `DailySyncContent`, run the AI compose if enabled, and email **only the requesting admin** via `sendTeamEmail` (admins are `@graceandassociates.com`, already allowlisted — no customer risk). Admin-gated.
- Button lives in the new panel (near the existing `GenerateSyncButton` pattern, `app/(app)/settings/…`). This is how an admin verifies the layout AND the `{ai_brief}` output before trusting it.

## 6. ⭐ Operability + gate
Standing constraint ([[operability-built-to-outlive-us]]): a non-technical admin shapes the morning email **from the dashboard, no deploy, no HTML** — and every risky knob has an obvious recovery.
- Fixed HTML shell (can't break the email chrome); editable body is text+shortcodes only.
- **AI toggle default OFF** — nothing changes until it's deliberately flipped; one click off.
- **Reset to default** on both textareas; **blank template → default**; **AI failure → deterministic email still sends**; unknown shortcodes shown literally + warned, not silently dropped.
- **Test-send** = the one obvious "does it look right?" button before 6 AM.

**Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`; worker tests stay green. Add worker unit tests (pure, **no live LLM**):
- `renderTemplate(DEFAULT_DAILY_SYNC_TEMPLATE, sampleContent)` reproduces today's sections (assert the key HTML fragments/headings are present, in order);
- unknown `{shortcode}` renders literally; blank template falls back to default; `{ai_brief}` with `aiBrief:null` renders empty;
- `resolveDailySyncTemplate` / prompt resolution = override-else-default (blank → default), and the assembled AI **source string contains only the provided facts** while the prompt carries the "only provided info" rule.
- Preview-verify as admin: new tab renders; the 4 controls are **gone from Notifications** and present here; template + shortcode list + AI toggle + AI prompt; **test-send delivers**; Reset works; a **viewer/standard cannot** see/patch (`isAdmin` on both verbs, `settings.access` false for non-admins).
- **No migration.** Worker + web deploy separately (Coolify, manual) — the worker must tolerate every new key being absent (default template, AI off) so ship order doesn't matter.

## 7. Explicitly OUT of scope (v1)
- **Per-meeting** AI briefs (one firm-wide `{ai_brief}` only). Deeper per-transcript retrieval for the AI (v1 grounds on the deterministic brief data — transcript-derived summaries + tasks).
- Raw-HTML template editing, WYSIWYG, a real templating engine/dependency, custom user-defined shortcodes.
- Editing the outer email chrome, the plain-text-only shell, versioning/history of edits, scheduling beyond the existing send-hour.
- The `/daily-sync` **page** rendering can keep its current deterministic view; matching it to the template is a nice-to-have, not required for v1 (the email is the deliverable).
