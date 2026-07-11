/**
 * Recall.ai bot dispatch + transcript fetch (docs/07 §1, §3).
 *
 * Shared helper (P4.2): the implementation lives here so BOTH callers use one
 * definition of "send a bot to a join URL":
 *   - the WORKER bot-dispatch cron (calendar + time-window + kill-switch gated),
 *     via the `apps/worker/src/lib/recall.ts` re-export shim; and
 *   - the WEB on-demand join route (`POST /api/calendar/join`), which dispatches
 *     SYNCHRONOUSLY for instant UI feedback.
 * Mirrors the earlier `@gracie/shared/extract` + `/domains` promotions.
 *
 * Kept dependency-free (`fetch`, no SDK) to mirror the provider adapters and so a
 * backend subpath import never drags an SDK into the web bundle. The Recall API
 * key is resolved by the CALLER (`getCredential('recall')`, `@gracie/db`) and the
 * region by env (`RECALL_REGION`); this module stays pure.
 *
 * DEPLOY-TIME FOLLOW-UP (do not block on this — see the P5b brief's Escalate §):
 * the webhook + live transcript endpoint are not registered with Recall until
 * deploy, so the P5b pipeline is proven end-to-end via `transcriptOverride`.
 * During P5b verification the live key reached Recall but reported that the v1
 * `/bot/{id}/transcript/` route below is now LEGACY ("please use the updated
 * endpoint": https://docs.recall.ai/reference/transcript_retrieve). Wiring the
 * modern transcript_retrieve flow (resolve the transcript id from the bot's
 * recording → fetch its download URL → parse) needs a real bot payload to test
 * against, so it is deferred to deploy; swap the URL + parser when it is wired.
 */

export interface RecallFetchOptions {
  readonly apiKey: string;
  /** Recall region subdomain (env `RECALL_REGION`); defaults to `us-west-2`. */
  readonly region?: string;
}

/**
 * Auto-leave timeouts in SECONDS (Settings → Meeting Bot). Each maps to a flat
 * Recall `automatic_leave.*` field; `null`/omitted leaves it unset so Recall's own
 * default applies. Kept structurally identical to `@gracie/db`'s `BotAutoLeave` so
 * a resolved config passes straight through (shared must not depend on db).
 */
export interface RecallAutoLeave {
  readonly everyoneLeftSec?: number | null;
  readonly waitingRoomSec?: number | null;
  readonly noRecordingSec?: number | null;
  readonly nooneJoinedSec?: number | null;
}

/** Options for dispatching a Recall bot into a meeting (P4, docs/07 §1). */
export interface RecallDispatchOptions extends RecallFetchOptions {
  /** The join URL the bot dials into (`meetings.video_link`). */
  readonly meetingUrl: string;
  /** Display name the bot joins as (shown to human attendees). */
  readonly botName?: string;
  /**
   * Base64 JPEG (no data: prefix) shown as the bot's video tile via Recall's
   * `automatic_video_output` (docs: output-video-in-meetings). Omit for no tile.
   * Must be JPEG, 16:9, ≤1.3 MB.
   */
  readonly botAvatarJpegB64?: string | null;
  /** Auto-leave timeouts; omitted fields fall back to Recall defaults. */
  readonly autoLeave?: RecallAutoLeave;
}

const DEFAULT_BOT_NAME = 'Gracie';

/**
 * Map our auto-leave option (seconds) to Recall's flat `automatic_leave` fields,
 * sending ONLY the ones that are set. Returns undefined when nothing is set, so
 * the field is omitted entirely and Recall applies all its defaults.
 */
function buildAutomaticLeave(al: RecallAutoLeave | undefined): Record<string, number> | undefined {
  if (al === undefined) return undefined;
  const out: Record<string, number> = {};
  if (typeof al.everyoneLeftSec === 'number') out.everyone_left_timeout = al.everyoneLeftSec;
  if (typeof al.waitingRoomSec === 'number') out.waiting_room_timeout = al.waitingRoomSec;
  if (typeof al.noRecordingSec === 'number') out.in_call_not_recording_timeout = al.noRecordingSec;
  if (typeof al.nooneJoinedSec === 'number') out.noone_joined_timeout = al.nooneJoinedSec;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A transcript segment as returned by Recall's transcript endpoint. */
interface RecallTranscriptSegment {
  readonly speaker?: string | null;
  readonly text?: string | null;
  readonly words?: ReadonlyArray<{ readonly text?: string | null }> | null;
}

const DEFAULT_REGION = 'us-west-2';

function baseUrl(region: string | undefined): string {
  return `https://${region ?? DEFAULT_REGION}.recall.ai/api/v1`;
}

/** Join one segment into a `Speaker: words…` line, tolerating either response shape. */
function segmentToLine(segment: RecallTranscriptSegment): string {
  const text =
    typeof segment.text === 'string' && segment.text.trim() !== ''
      ? segment.text.trim()
      : (segment.words ?? [])
          .map((word) => word.text ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
  if (text === '') return '';
  const speaker = segment.speaker?.trim();
  return speaker !== undefined && speaker !== '' ? `${speaker}: ${text}` : text;
}

/**
 * Dispatch a Recall bot into a meeting (docs/07 §1). Creates the bot via
 * `POST /bot` with the meeting's join URL; returns the Recall bot id, which the
 * caller stores as `meetings.bot_job_id`. When the meeting ends, Recall calls the
 * (already-built, P5b) `POST /api/webhooks/recall` webhook — which matches the
 * meeting by that `bot_job_id` and runs generation. P4's job ends here.
 *
 * Throws on a non-OK response so the caller decides how to recover: the worker
 * cron retries the next sweep, and the on-demand join route rolls back the
 * just-created meeting row so a failed dispatch is never silently dropped.
 */
export async function dispatchRecallBot(options: RecallDispatchOptions): Promise<string> {
  const body: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName ?? DEFAULT_BOT_NAME,
  };

  // Static image tile: show it both while recording and before, so the bot always
  // presents Gracie's face rather than a blank participant tile.
  if (typeof options.botAvatarJpegB64 === 'string' && options.botAvatarJpegB64 !== '') {
    const image = { kind: 'jpeg', b64_data: options.botAvatarJpegB64 };
    body.automatic_video_output = { in_call_recording: image, in_call_not_recording: image };
  }

  const automaticLeave = buildAutomaticLeave(options.autoLeave);
  if (automaticLeave !== undefined) body.automatic_leave = automaticLeave;

  const res = await fetch(`${baseUrl(options.region)}/bot/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Recall bot dispatch failed for ${options.meetingUrl} (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { id?: string };
  if (typeof data.id !== 'string' || data.id === '') {
    throw new Error('Recall bot dispatch response had no bot id');
  }
  return data.id;
}

/**
 * Fetch and flatten the transcript for a Recall bot job. Throws on a non-OK
 * response so the caller (BullMQ) retries transient failures with backoff.
 */
export async function fetchRecallTranscript(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<string> {
  const res = await fetch(`${baseUrl(options.region)}/bot/${botJobId}/transcript/`, {
    headers: { Authorization: `Token ${options.apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Recall transcript fetch failed for bot ${botJobId} (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as RecallTranscriptSegment[];
  if (!Array.isArray(data)) {
    throw new Error(`Recall transcript for bot ${botJobId} was not an array`);
  }
  const transcript = data
    .map(segmentToLine)
    .filter((line) => line !== '')
    .join('\n');
  if (transcript.trim() === '') {
    throw new Error(`Recall transcript for bot ${botJobId} was empty`);
  }
  return transcript;
}
