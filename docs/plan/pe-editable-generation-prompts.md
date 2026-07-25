# Delegation Brief — PE: Editable Generation Prompts

> Self-contained brief for a fresh Claude Code session. Read §0 + §4 first.
> **Platform:** macOS, Node 24, pnpm. Web `apps/web`, worker `apps/worker`, shared `packages/shared`, DB `packages/db`.
> **Branch + PR. Do NOT push to `main`.** Small, config-to-UI feature — mirror P9's settings panels, don't invent new infra.

---

## 0. What + where
Admins edit, from the dashboard (no deploy), the prompts Gracie uses to write the **post-meeting documents**. Today those live hardcoded in the worker:
- `apps/worker/src/lib/generate.ts` → `const DOC_INSTRUCTIONS: Record<GeneratedDocType, string>` — the 6 per-doc "Your Task" instructions (layer 3). **These are the editable target.**
- `assemblePrompt` (`packages/shared/src/ai/prompts/assembly.ts`) wraps each instruction with the global system prompt + tone/[VERIFY]/JSON rules. **Out of scope for v1** (see §3).
- The 6 doc types + metadata: `packages/shared/src/ai/generated-docs.ts` (`GENERATED_DOC_SPECS`, `label`, `audience`, `requiresReview`, `responseFormat`).
- Company description (layer 1) is already editable via P9 Company Settings — not this.

## 1. The lazy design (mirror P9)
- **Move `DOC_INSTRUCTIONS` into `@gracie/shared`** (e.g. next to the specs in `ai/generated-docs.ts`, or `ai/prompts/defaults.ts`) as the single source of default prompts. Worker imports it instead of defining it; web imports it to show the default. (The old comment "kept out of shared so wording stays tunable with the pipeline" is now obsolete — it's tunable via settings.)
- **Store overrides in ONE settings row:** `generation_prompt_overrides` = JSON `{[GeneratedDocType]: string}`. A missing/blank type → use the shared default. (One key, one reader — reuse `getSettingString` / the P9 settings read-write helpers.)
- **Worker:** in `generate.processor.ts`, read the overrides once per run and pass a resolved map into `generateDocuments`; `generateOne` uses `override[type] ?? DEFAULT[type]`. That's the whole behavior change.
- **No migration** (settings row).

## 2. Web UI (admin, mirror P9 Company/Scoring panels)
- New `GenerationPromptsPanel` in Settings (`can('settings.access')`, admin) — one collapsible section listing the 6 docs **in generation order**, each: label + audience/requiresReview badges + a textarea prefilled with the **effective** prompt (override or default) + a **"Reset to default"** per doc (clears that type's override).
- `lib/data/generation-prompts.ts` + `GET/PATCH /api/settings/generation-prompts` (admin, same gate/shape as P9's company/scoring routes). GET returns, per type: `{ label, audience, requiresReview, default, override|null }`. PATCH sets/clears overrides (validate: non-empty when set; ignore unknown types).
- **`task_checklist` is special:** its prompt must return the exact JSON shape or task extraction breaks. Show a clear inline warning on that one ("Changing this can break automatic task creation — keep the JSON format") — allow editing (Reset is the escape hatch), don't build a locked sub-editor.

## 3. Explicitly OUT of scope (v1)
- The global wrapper / system prompt / tone rules in `assembly.ts` (higher blast radius — a separate decision if wanted).
- The task-extraction strict re-ask string, chat/assistant prompts, deterministic briefs (`brief.ts` — not AI).
- Versioning/history of prompt edits, per-client prompt overrides. YAGNI unless asked.

## 4. ⭐ Operability + gate
Standing constraint ([[operability-built-to-outlive-us]]): a non-technical admin tunes what Gracie writes **from the dashboard, no deploy, no code**. So: prefill the real current text (never a blank box), plain labels, and **"Reset to default" is the one obvious safety button** — a bad edit is always one click from recovery.
- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`; worker tests stay green (the default map moved, not changed — assert the shared defaults are non-empty for all 6 types).
- Preview-verify as admin (edit a prompt → save → reset) and confirm a **viewer/standard cannot** see/patch it.
- Prove the worker path: an override actually changes the instruction sent to the provider (a small unit check on the `override ?? default` resolution is enough — no live LLM call needed).
- No secrets; no migration; scope commits to explicit paths. Worker + web deploy separately — the worker must tolerate the settings key being absent (falls back to defaults) so ship order doesn't matter.
