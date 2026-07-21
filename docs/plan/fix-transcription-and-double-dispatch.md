# Delegation Brief — Worker: reliable transcription + stop double-dispatch + recover GA/Leap Metrics

> Self-contained brief for a fresh Claude Code session. Read §0–§1 first.
> **Platform:** macOS, Node 24, pnpm. Worker `apps/worker`, shared `packages/shared`, DB `packages/db`.
> **Branch + PR. Do NOT push to `main`.** Worker deploys separately. Captured 2026-07-21 from a live production failure.
> **⚠️ Read the standing operability constraint in §5 — it applies to everything you build here.**

---

## 0. Context (all verified live 2026-07-21)
Bot auto-dispatch (`calendar_bot_dispatch_enabled`) is **ON** and has been since ~2026-07-11. Since the webhook fix (#46) the pipeline works end-to-end: a recorded meeting produces 6 documents unattended. Two real defects were then found in production, on the same meeting.

**Defect A — transcription failed, so a client meeting produced NO documents.**
`GA/Leap Metrics` (external client, 2026-07-21 14:00 UTC) recorded perfectly but produced nothing. Recall's own data:
```
recording bcb9370a-e592-405d-80d4-68f8aab1b04f  (bot 00f3c685-fca1-49e7-bced-760962f16480)
  recording.status : done
  video_mixed      : done, download available
  transcript       : FAILED  sub_code = provider_connection_failed
```
The same failure hit **both** bots on that call (the other: bot `474d5018-8d6a-47a7-8019-0a4dd59e96b2`). A single-bot meeting the same day (`Daily Sync`, bot `71c02734…`) transcribed fine with an **identical** `recording_config`. So our dispatch config is correct — the *provider* failed.

We use `recording_config.transcript.provider.recallai_streaming` — a **real-time streaming** provider that holds a live connection per bot. **Nothing in gracie consumes a live stream**: the pipeline reacts to the `transcript.done` webhook *after* the meeting and then fetches the transcript. Streaming buys us nothing and adds a live-connection failure mode.

**Defect B — two Gracie bots joined the same client call.**
The dispatch guard dedupes per meeting row / `calendar_event_id`, but two *distinct* Outlook events can point at one real call (duplicate/overlapping invites). Verified: two `GA/Leap Metrics` rows, **different `calendar_event_id`, identical `video_link`, identical `date_time`** — each got its own bot. A paying client saw two "Gracie" notetakers. It repeats across the whole series: `2026-07-07`, **`07-21` (2 bots actually fired)**, `08-04`, `08-18`, `09-01`, `09-15`.

**Suspected causal link (worth noting, not proven):** two bots in one call = two concurrent streaming-transcription sessions on one account; both failed with `provider_connection_failed` while the single-bot meeting succeeded. Fixing B may also reduce A.

## 1. Build (three parts)

### 1.1 Switch transcription from streaming → ASYNC (root cause)
- **Verify the exact current API first** — WebFetch Recall's transcription docs (`https://docs.recall.ai/docs/async-transcription` + the create-bot `recording_config` reference). **Do not guess the provider key.**
- Change the default transcript provider used by `dispatchRecallBot` (`packages/shared/src/recall/index.ts` — see the provider mapping around the `transcriptProvider` option) from the streaming provider to an **async** one, so Recall transcribes after the recording completes instead of over a live connection.
- The provider is already tunable via `bot_config` (Settings → Meeting Bot; `packages/db/src/bot-config.ts`). Keep it tunable, change the **default**, and make sure the stored/default value maps to the async provider. If an existing saved `bot_config` pins the streaming provider, migrate/normalise it so the fix actually takes effect in prod (don't let a stale settings row silently keep streaming).
- Confirm the downstream contract still holds: the webhook still gates on `transcript.done`, and `fetchRecallTranscript` still resolves via `media_shortcuts.transcript.data.download_url`. Adjust only if the async shape genuinely differs.

### 1.2 Stop double-dispatch (client-visible)
- In `apps/worker/src/processors/bot-dispatch.processor.ts`, before dispatching, **skip when another meeting with the same `video_link` AND the same `date_time` already has a bot** (`bot_dispatched = true` / non-null `bot_job_id`). One bot per real call.
- **Preserve the legitimate case:** a recurring series shares ONE `video_link` across occurrences on **different** dates (e.g. `Daily Sync`). Dedupe MUST key on **(video_link + start time)** — never on `video_link` alone, or you'll suppress every recurrence after the first.
- Make the skip **observable**: log it, and record enough that the Pipeline view can later explain "not dispatched — another bot is already covering this call" rather than looking like a silent failure.
- Add a regression test for both: same link + same start → one dispatch; same link + different starts → one dispatch each.

### 1.3 Recover GA/Leap Metrics (the client's notes are currently missing)
- The recording survives and is downloadable. Recover it by requesting **async transcription on the existing recording** `bcb9370a-e592-405d-80d4-68f8aab1b04f`, then running generation.
- **Generate against meeting `72bae1d3-026a-47ef-982b-d38a4765073e` ONLY.** The duplicate row `0aa5cf11-2498-4819-a106-59743a76457f` is the *same real call* — generating both would produce two sets of 6 documents for one meeting. Leave the duplicate marked so it doesn't read as a silent failure (and it must not later self-heal into a second doc set).
- Use the same Recall account/region the bots used (region `us-west-2`; the key the worker resolves via `getCredential('recall')`). Verify the result: 6 documents filed under the correct client + occurrence folder.
- If recovery is cleaner as a one-off script than as shipped code, that's fine — keep it OUT of the committed PR (or clearly mark it one-off).

## 2. Explicitly OUT of scope
The Pipeline fleet view, the in-app recovery UI, and the automatic self-heal watchdog are a **separate brief**: `docs/plan/pipeline-fleet-view-and-recovery.md`. Don't build UI here. This brief is prevention + one manual recovery.

## 3. Gate + safety
- Green gate: `pnpm -w typecheck` + `pnpm -w lint`, worker tests stay green (add the dedupe tests from §1.2).
- **Do not** touch `calendar_bot_dispatch_enabled` (it is ON — leave it ON), the webhook contract, or the external-send switch.
- Generation stays idempotent per meeting; the #45 series/occurrence key scheme is unchanged.
- Expect **no migration**. If you truly need one, make it additive + idempotent, hand-regen `database.types.ts`, and **DO NOT apply it** — flag it for the orchestrator.
- No secrets staged (the Recall key lives in `apps/worker/.env.local` / `integration_credentials` — never commit or echo it).

## 4. PR notes
- The async provider key you verified (with the doc link), the default change, and how you ensured a stale `bot_config` can't keep streaming.
- The dedupe rule + proof the recurring-series case still dispatches per occurrence.
- Recovery result: which meeting got docs, how many, which duplicate row you left alone.
- Confirm no migration; confirm the kill-switch untouched.

## 5. ⭐ Standing operability constraint (applies here and to every future brief)
At handover the only actors are **the AI and non-technical GA staff** — no engineer, no Claude. **No recovery path may require a console, a script, SQL, or a log.** For this brief that means: when a bot is skipped or a transcription fails, the reason must be **recorded in a form the app can show in plain language** ("The recording is fine, but the notes couldn't be created"), never only in a container log. Anything a human must eventually do should reduce to **one obvious button** built in the Pipeline brief — your job here is to make sure the data it needs exists.
**Acceptance test:** *could a new GA staffer, with no context and no engineer, understand this state from the dashboard?*
