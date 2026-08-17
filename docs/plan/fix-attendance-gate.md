# HOTFIX — attendance gate reads real `participant_events` + fails open on empty

**Branch:** `fix/attendance-gate-participants` · **Type:** production hotfix · do NOT merge before review.

## Symptom (live in prod)
PR #111's ghost-meeting **attendance gate** was skipping REAL meetings with the
message *"No real meeting — fewer than two people joined."* ~21 meetings + a Daily
Sync + ad-hoc calls were marked as no-show skips despite having full recordings +
finished transcripts on Recall.

## Root cause
`extractParticipants` reads the bot-retrieve field `bot.meeting_participants`. On
this Recall account **that field is empty/absent** — the real join list lives only
in the recording's `participant_events` signed download. So:

`extractParticipants(bot)` → `[]` → `decideAttendanceGate([])` returned
`{ ok: false, reason: 'too_few_participants' }` → every real meeting skipped. The
existing fail-open only fired on a *thrown* error; an empty list is not an error, so
it never triggered.

### Verified against real data (bot `491a3d06-8932-4ef0-ab90-306eedd35f9a`, 2026-08-17)
`GET /api/v1/bot/491a3d06…/` returned `meeting_participants: null`. The real people
came from `recordings[0].media_shortcuts.participant_events` (`status.code = "done"`),
whose `data.participant_events_download_url` (a signed URL, fetched WITHOUT the Recall
auth header) returns a **flat array of 2272 events**. One event:

```json
{
  "id": "478dccab-…",
  "action": "join",                         // also: leave, speech_on/off, webcam_on/off, screenshare_on, update
  "timestamp": { "absolute": "2026-08-11T19:38:30.751351Z", "relative": 0.0 },
  "participant": {
    "id": 100,
    "name": "Allie Grace",
    "is_host": false,
    "platform": "unknown",
    "extra_data": { "microsoft_teams": { "role": "…", "meeting_role": "presenter", … } },
    "email": null
  },
  "data": null
}
```

Across all 2272 events there are exactly **2 distinct `participant.id`s** — 100
"Allie Grace" and 200 "Daniel Velez" (both GA staff, `email` always `null` because
Teams hides it). Recall also exposes a sibling `participants_download_url` that
returns those same 2 distinct people directly; we chose to derive from
`participant_events` per the hotfix brief.

**What we parse:** for every event we read `event.participant`, take
`{ name, is_host, email (direct or extra_data.email) }`, and **dedupe on the stable
per-call `participant.id`** (falling back to `name|email` when `id` is absent). Later
events enrich a person's host flag / name / email. Result for the real bot:
`[{name:"Allie Grace",isHost:false,email:null}, {name:"Daniel Velez",isHost:false,email:null}]`
→ 2 distinct, ≥1 internal → **gate passes, generation proceeds** (was: skipped).

## The fix
### 1. Correctness — `packages/shared/src/recall/index.ts`
- Added `participant_events` to the `RecallBotRecordings` media_shortcuts type.
- `findParticipantEventsUrl(bot)` (pure) — first non-empty download URL, else null.
- `parseParticipantEvents(raw)` (pure) — dedupes the event stream to distinct
  `RecallParticipant`s (by id, then name+email).
- `fetchRecallParticipants` now: prefer `meeting_participants` **when populated**
  (unchanged fallback); otherwise follow `participant_events_download_url`, GET it
  WITHOUT the Recall auth header (same pattern as the transcript download), and parse.
  Any download/parse failure → `[]` (best-effort; only the bot-retrieve itself throws).

### 2. Safety — fail open — `apps/worker/src/processors/generate.processor.ts`
- `decideAttendanceGate`: an **empty** distinct list now returns `{ ok: true }`
  (attendance UNKNOWN → proceed). It only skips when it **affirmatively** sees a
  non-empty list of fewer than two people (`too_few_participants`) or ≥2 with no GA
  attendee (`no_internal_participant`). The existing "GA-associated → proceed"
  safeguard is unchanged.
- `checkMeetingHappened` already fails open on no-bot / no-key / thrown Recall error;
  combined with the empty→ok gate, an empty/unreadable list now proceeds too.

The #111 ignore-list feature is untouched.

## Tests (worker suite, all green — 203 pass / 0 fail)
- `parseParticipantEvents`: dedupes a join/leave/speech stream by id; enriches host
  flag from a later event; reads email direct or from `extra_data`; non-array/empty → `[]`.
- `findParticipantEventsUrl`: first URL else null.
- `fetchRecallParticipants`: `meeting_participants` empty → follows the
  `participant_events` download, and the signed download carries **no** Authorization
  header (the bot-retrieve does); a download failure → `[]` (fail-open, never throws).
- `decideAttendanceGate`: empty list → `{ ok: true }` (fail-open); exactly one real
  person → `too_few_participants`; unchanged: ≥2+internal → ok, ≥2 no-GA →
  no_internal, rejoin/blank dedupe.

## Verification
Ran the **real** `parseParticipantEvents`/`extractParticipants` over the real bot's
downloaded payload via tsx: `extractParticipants(bot)` = `[]` (today's bug),
`parseParticipantEvents(2272 events)` = the 2 distinct GA people. Gate → proceed.

Gate: `pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ · worker tests 203/203 ✅.
