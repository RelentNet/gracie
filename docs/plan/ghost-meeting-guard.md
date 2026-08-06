# Ghost-meeting guard — attendance gate + ignore list

**Branch:** `feat/ghost-meeting-guard` · **Status:** built, gate-green, PR open (not merged)
**Migration:** none (ignore list is a `settings` row)

## Problem

Since #87 Gracie records EVERY meeting with a join link. Stale/duplicate recurring
calendar entries (the "InterSystems ghost") make a bot dial into a call that never
really happens — and an empty recording then flowed into generation as a **red
pipeline failure** (`transcript produced no chunks`). Two guards fix this.

## Guard 1 — Attendance gate (post-meeting, `generate.processor`)

A recording counts as a real meeting only when **≥2 distinct people actually joined
AND ≥1 is internal/GA**. Runs right after the meeting loads, before client
resolution and before any docs — so it is independent of whether a client is linked
(*gate on "did it happen", not on assignment* — a real-but-unlinked meeting still
proceeds and generate-on-link fills in its notes later).

- New shared helper `fetchRecallParticipants` / `extractParticipants` +
  `RecallParticipant` in `packages/shared/src/recall/index.ts` (mirrors the existing
  bot-retrieve helpers; reads `meeting_participants`, tolerating email on the
  participant or in `extra_data`).
- Pure, unit-tested `decideAttendanceGate(participants, isInternal)` in
  `generate.processor.ts` (next to `resolveMeetingClientId`) → `{ ok }` |
  `{ ok:false, reason: 'too_few_participants' | 'no_internal_participant' }`. Dedupes
  a rejoin (same name+email listed twice); drops blank entries.
- Wrapper `checkMeetingHappened` builds `isInternal` (internal email domain, known GA
  staff email, or a joined display name matching GA staff) and excludes Gracie's own
  bot by name so the ≥2 bar counts real humans.
- Failing the bar → `markNoShow`: a **benign** skip mirroring the no-client/duplicate
  skips — meeting → `cancelled` (never over a `complete`), a status-null
  `pipeline_runs` row with a plain-language reason, no docs, no transcript stored.
  Returns `status: 'skipped'`.

### Safety (never lose a real meeting)

- **Scope:** only FRESH recordings (`botJobId` set AND `transcript_received === false`).
  A re-run / generate-on-link is never re-gated (Recall retention may have lapsed →
  no participant data → would wrongly skip).
- **Fail-open:** no bot / no Recall key / a Recall error → proceed.
- **GA-associated downgrade:** a `no_internal_participant` result is downgraded to
  proceed when the meeting is `is_internal` or has invited GA staff
  (`attendee_user_ids`) — Teams often hides emails and shows nicknames, so the fuzzy
  name match must not drop a meeting we already know is GA's. The robust ≥2 bar
  (the actual empty-room ghost) still holds.

## Guard 2 — "Don't record" ignore list

Staff mark a recurring calendar entry (or one-off) so Gracie skips dispatch.

- **Storage (no migration):** a `bot_ignore_list` `settings` row of `{ key, label }`
  in `packages/db/src/bot-config.ts` (`getBotIgnoreList` / `addBotIgnoreEntry` /
  `removeBotIgnoreEntry`). `key` = the stable `meetings.series_id` when present (so
  every occurrence is skipped), else the join link. `label` = the meeting title.
- **Dispatch skip (`bot-dispatch.processor`):** candidate select adds `series_id`;
  pure, unit-tested `isMeetingIgnored`; `decideDispatch` gains `skip_ignored`
  (checked before dedupe, after opt-out). The sweep **does not claim or cancel** an
  ignored meeting — it stays `scheduled`, so turning the toggle back on restores
  dispatch on the next sweep (reversible, self-healing). New `skippedIgnored` counter.
- **Control (operable, calendar day detail):** a per-meeting **"Don't record" /
  "Turn recording on"** toggle in `DayDetail.tsx` (admin / `calendar.configure`),
  posting to `POST /api/calendar/meetings/[id]/ignore` (`{ ignore: boolean }`,
  admin-gated). The server resolves the key + label from the meeting id, so the
  client never handles a series id. `CalendarMeeting.recordingIgnored` (computed in
  `listCalendarMeetings`) drives the toggle state; enabling confirms first since it
  affects the whole series. Discoverable + reversible from the calendar where the
  meeting lives — no console/SQL.

## Tests

- `decideAttendanceGate` — pure decision (brief requirement): ok / too_few / rejoin /
  no_internal / blanks-dropped / name-only internal match.
- `extractParticipants` + `fetchRecallParticipants` (recall.test.ts).
- `isMeetingIgnored` + `decideDispatch` skip_ignored (series & link; ordering vs
  duplicate & opt-out) (bot-dispatch.test.ts).
- Gate: `pnpm -r typecheck` ✓, `pnpm -r lint` ✓, worker 185/185 ✓, web 55/55 ✓.

## Deploy

Web + worker redeploy (Coolify manual). No migration to apply. Ignore list starts
empty; attendance gate is fail-open + fresh-only, so it silently upgrades the ghost
path from red failure to benign skip with no config.
