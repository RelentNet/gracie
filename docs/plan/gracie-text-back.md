# Gracie replies in-meeting + voice "action item" capture

Extends the in-meeting voice-command system (#99). Two additions, both **wake-word-gated
only** (Gracie never speaks unsolicited) and behind the SAME gates #99 established:
DEFAULT-OFF `bot_config.voiceCommands` + realtime transcript, host-only speaker gate, and
the per-meeting debounce.

## What ships

1. **Voice "action item" capture** — a host says *"Hey Gracie AI, action item: send the Q3
   proposal to Sarah"* and Gracie creates a **high-confidence task** for the meeting's client,
   then confirms in the meeting chat (*"Noted — added: …"*). The item runs through #106's
   dedup + owner-on-name rules (see below), so a re-mention escalates instead of duplicating.

2. **Chat reply plumbing** — `sendRecallChatMessage` (reused as-is from #99, not modified) now
   backs an acknowledge/echo path (`safeChat`) so future wake-word commands can reply in-chat
   without new plumbing.

## How it works

- **Parser** (`packages/shared/src/recall/voice-commands.ts`): `parseVoiceCommand` gains an
  `action_item` command. It is matched **before** `leave`/`pause`, so a dictated item whose
  text happens to contain "leave"/"pause" is stored as content, never executed as a control.
  The command carries the **raw** (un-normalized) text so the task keeps natural
  casing/punctuation; empty cues ("action item:") and no-wake-phrase utterances yield `null`,
  and the text is length-capped (`MAX_ACTION_ITEM_CHARS = 400`).

- **Handler** (`apps/web/lib/voice-commands.ts`): same config → host → debounce chain as #99.
  The debounce key includes a hash of the item text so two *different* items in the same
  window aren't collapsed — only STT repeats of the same one. It resolves the meeting's client
  (primary org, or the internal GA org for internal meetings), creates the task **then**
  confirms (so Gracie never claims "added" for something that failed), and says so plainly when
  the meeting has no client linked yet.

- **Task creation** (`apps/web/lib/data/tasks.ts` → `createVoiceActionItem`): reuses the same
  lifecycle helpers the meeting pipeline uses — dedup (`findDuplicateTask` →
  `decideTaskUpsert`: escalate an active match / reactivate an archived one), owner-on-name
  (`resolveOwnerFromText`, a new freeform wrapper over #106's `resolveTaskOwner`), and the
  per-client active cap (`decideCapEvictions`). A dictated item is always HIGH.

## Reuse note (single source of truth)

#106's pure lifecycle helpers lived in `apps/worker/src/lib/task-lifecycle.ts`, which the web
app can't import (sibling app). They were **moved** to `@gracie/shared/tasks`; the worker file
is now a thin re-export, so #106's processors and tests are unchanged. `sendRecallChatMessage`
and the other Recall dispatch helpers in `packages/shared/src/recall/index.ts` were **not**
touched (sibling-PR conflict avoidance).

## Reliability trade-off

This rides the realtime-transcript reliability trade-off documented in #99: capture depends on
Recall's realtime transcript delivering the utterance, and on the platform reporting the
speaker's host flag. When either is missing the feature simply does nothing (fail safe) — a
missed action item is a non-event, never a wrong one.

## Deliberate simplifications

- Owner-on-name for voice scans the item's words for a staffer's name (first hit wins). A word
  that happens to equal a staffer's name can misassign; upgrade to model-extracted hints if it
  bites (`ponytail:` noted in code).
- No new migration, no new dependency, no new queue — task creation runs inline from the web
  handler exactly like #99's leave/pause controls.

## Tests

- Parser (`apps/worker/src/lib/voice-commands.test.ts`): captures text, wins over control
  verbs in its text, requires a wake phrase, rejects empty cues, length-caps.
- Lifecycle (`apps/worker/src/lib/task-lifecycle.test.ts`): `resolveOwnerFromText` assigns from
  a named staffer and stays null otherwise.
- Full gate: `pnpm -r typecheck` + `pnpm -r lint` + worker tests (178) all green.
