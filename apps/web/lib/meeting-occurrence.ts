/**
 * Pure logic for the meeting-occurrence page (`/meetings/[id]`, Phase A). No DB, no
 * `server-only`, so it is unit-testable and importable from either side.
 *
 * Three status-adaptive states (docs/plan meeting-occurrence-page §3 Phase A):
 *   - `upcoming`   — the meeting hasn't happened yet.
 *   - `in_session` — now is inside the scheduled window AND a bot was dispatched
 *                    (a time-window heuristic; precise `in_call_recording` bot
 *                    status is Phase B, deliberately NOT done here).
 *   - `ended`      — the meeting is over / recorded.
 */
import type { FleetState } from './pipeline-reason';
import type { PipelineStatus } from '@gracie/shared';

export type OccurrenceState = 'upcoming' | 'in_session' | 'ended';

/** Fallback meeting length when the calendar gave us no duration. */
const DEFAULT_DURATION_MIN = 60;

export interface OccurrenceStateInput {
  /** Scheduled start, ISO 8601. */
  readonly dateTime: string;
  readonly durationMinutes: number | null;
  readonly pipelineStatus: PipelineStatus;
  readonly isBotDispatched: boolean;
  readonly isTranscriptReceived: boolean;
}

/**
 * Derive the occurrence state. Recorded signals win over the clock (a meeting can
 * end early), then the scheduled window decides upcoming vs in-session vs ended.
 *
 * `in_progress` is deliberately left to the clock: it is the one pipeline_status
 * that is genuinely ambiguous ("pipeline running" vs "meeting running"), so we let
 * the scheduled window rule instead of forcing `ended`. `awaiting_transcript` and
 * `processing` only ever happen AFTER a recording, so they force `ended`.
 */
export function deriveOccurrenceState(
  input: OccurrenceStateInput,
  now: Date = new Date(),
): OccurrenceState {
  if (input.isTranscriptReceived) return 'ended';
  if (
    input.pipelineStatus === 'complete' ||
    input.pipelineStatus === 'needs_attention' ||
    input.pipelineStatus === 'awaiting_transcript' ||
    input.pipelineStatus === 'processing'
  ) {
    return 'ended';
  }

  const startMs = Date.parse(input.dateTime);
  if (Number.isNaN(startMs)) return 'upcoming'; // no usable time → safest default
  const endMs = startMs + (input.durationMinutes ?? DEFAULT_DURATION_MIN) * 60_000;
  const nowMs = now.getTime();

  if (nowMs >= endMs) return 'ended';
  if (nowMs >= startMs && input.isBotDispatched) return 'in_session';
  return 'upcoming';
}

export interface MeetingFleetInput {
  /** True when a `pipeline_runs` row exists for this meeting. */
  readonly hasRun: boolean;
  /** `pipeline_runs.status` — null is the duplicate-skip explanation row (§3.1). */
  readonly runStatus: 'success' | 'failed' | 'partial' | null;
  readonly pipelineStatus: PipelineStatus;
}

/**
 * Map this meeting's pipeline run (+ meeting status when there is no run) to a
 * `FleetState`, so the ended-state panel can reuse `describePipelineState`
 * verbatim. Mirrors `listPipelineFleet` (lib/data/pipeline.ts): a run's status is
 * authoritative; with no run, the meeting status stands in.
 */
export function deriveMeetingFleetState(input: MeetingFleetInput): FleetState {
  if (input.hasRun) return input.runStatus ?? 'skipped';
  switch (input.pipelineStatus) {
    case 'complete':
      return 'success';
    case 'needs_attention':
      return 'needs_attention';
    case 'cancelled':
      return 'skipped';
    default:
      // scheduled / in_progress / awaiting_transcript / processing
      return 'in_progress';
  }
}

/**
 * Where the ended-state player sources the transcript from (the "do both" rule):
 *   - `stored`   — we have our durable MinIO copy AND the caller may see it → use it.
 *   - `livepull` — no durable copy yet (a back-catalog meeting) → live-pull it from
 *                  Recall, then cache it forward.
 *   - `none`     — a durable copy exists but the caller can't see it (restricted
 *                  folder → NEVER fall through to a live-pull that would bypass the
 *                  restriction), or there's simply no transcript to show.
 * Pure + unit-tested; the I/O (fetch/read/cache) lives in the server data layer.
 */
export type TranscriptSource =
  | { readonly kind: 'stored'; readonly key: string }
  | { readonly kind: 'livepull'; readonly url: string }
  | { readonly kind: 'none' };

export function decideTranscriptSource(input: {
  /** `meeting_media.transcript_key`, or null when nothing is stored yet. */
  readonly storedKey: string | null;
  /** canAccessKey(storedKey) result — only meaningful when storedKey is set. */
  readonly storedAccessible: boolean;
  /** Fresh Recall transcript download URL, or null when not ready / absent. */
  readonly liveUrl: string | null;
}): TranscriptSource {
  if (input.storedKey !== null) {
    return input.storedAccessible ? { kind: 'stored', key: input.storedKey } : { kind: 'none' };
  }
  if (input.liveUrl !== null) return { kind: 'livepull', url: input.liveUrl };
  return { kind: 'none' };
}

/**
 * The most recent meetings BEFORE this occurrence (the "last 3 summaries" prep
 * material). Excludes the current meeting, keeps only strictly-earlier starts,
 * newest first, capped at `limit`.
 */
export function selectPriorMeetings<T extends { readonly id: string; readonly dateTime: string }>(
  meetings: readonly T[],
  currentId: string,
  currentDateTime: string,
  limit = 3,
): T[] {
  const currentMs = Date.parse(currentDateTime);
  return meetings
    .filter((m) => m.id !== currentId)
    .filter((m) => {
      const ms = Date.parse(m.dateTime);
      if (Number.isNaN(ms)) return false;
      return Number.isNaN(currentMs) || ms < currentMs;
    })
    .sort((a, b) => Date.parse(b.dateTime) - Date.parse(a.dateTime))
    .slice(0, Math.max(0, limit));
}

export interface ClientMeetingWindow<T> {
  readonly upcoming: readonly T[];
  readonly previous: readonly T[];
}

/**
 * Split a client's meetings (any order) into the 2 nearest UPCOMING (start >= now,
 * soonest first) and the 6 most-recent PREVIOUS (start < now, newest first — reuses
 * `selectPriorMeetings` with an empty id so nothing is excluded) for the client-detail
 * Meetings tab. Meetings with an unparseable start are dropped from both windows.
 */
export function splitClientMeetings<T extends { readonly id: string; readonly dateTime: string }>(
  meetings: readonly T[],
  now: Date = new Date(),
): ClientMeetingWindow<T> {
  const nowMs = now.getTime();
  const upcoming = meetings
    .filter((m) => {
      const ms = Date.parse(m.dateTime);
      return !Number.isNaN(ms) && ms >= nowMs;
    })
    .sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime))
    .slice(0, 2);
  return { upcoming, previous: selectPriorMeetings(meetings, '', now.toISOString(), 6) };
}
