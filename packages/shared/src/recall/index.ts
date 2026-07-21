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
 * TRANSCRIPTION (go-live fix): every dispatched bot now asks Recall to produce a
 * transcript via `recording_config.transcript.provider` (docs: transcription).
 * WITHOUT this the bot only records audio/video and `media_shortcuts.transcript`
 * stays null — the exact failure that left the first real bots un-transcribed.
 * The provider is tunable at dispatch (Settings → Meeting Bot → `getBotConfig`);
 * see `buildTranscriptProviderConfig` for the wire shapes.
 *
 * When the transcript finishes Recall fires the `transcript.done` webhook (which
 * carries `data.bot.id`); the route matches the meeting by `bot_job_id` and
 * enqueues generation, which calls `fetchRecallTranscript` below. Fetch uses the
 * CURRENT API (the v1 `/bot/{id}/transcript/` route is legacy): read the bot,
 * follow `recordings[].media_shortcuts.transcript.data.download_url`, then parse
 * the `[{ participant, words }]` array.
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

/**
 * Transcription provider selector (Settings → Meeting Bot). Kept structurally
 * identical to `@gracie/db`'s `BotTranscriptProvider` so a resolved config passes
 * straight through (shared must not depend on db):
 *   - `meeting_captions` — the meeting platform's own closed captions. No extra
 *     ASR cost, but Teams **Business** only and depends on captions being enabled
 *     at the org/meeting level (Recall: "not 100% reliable").
 *   - `recallai` — Recall's own ASYNC (post-meeting) ASR. Reliable regardless of
 *     caption settings; billed per hour. Transcribes AFTER the recording
 *     completes — deliberately not the streaming variant, see
 *     {@link buildTranscriptProviderConfig}.
 */
export type RecallTranscriptProvider = 'meeting_captions' | 'recallai';

/**
 * Default provider when a dispatch omits one. Kept in sync with
 * `@gracie/db`'s `DEFAULT_TRANSCRIPT_PROVIDER` so both the web and worker paths
 * behave identically; a bot is NEVER dispatched without a transcript provider.
 */
export const DEFAULT_TRANSCRIPT_PROVIDER: RecallTranscriptProvider = 'recallai';

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
  /**
   * Transcription provider for `recording_config.transcript`. Omitted →
   * {@link DEFAULT_TRANSCRIPT_PROVIDER}. A provider is ALWAYS sent so Recall
   * produces a transcript (see the module header).
   */
  readonly transcriptProvider?: RecallTranscriptProvider;
}

const DEFAULT_BOT_NAME = 'Gracie';

/**
 * Map our provider selector to Recall's `recording_config.transcript.provider`
 * wire shape (docs: recallai-transcription, async-transcription):
 *   - meeting_captions → `{ meeting_captions: {} }`
 *   - recallai         → `{ recallai_async: { language_code } }`
 *
 * `recallai` maps to the ASYNC provider, NOT `recallai_streaming`. Streaming
 * holds a live per-bot connection for the whole call and can fail with
 * `provider_connection_failed`, killing the transcript for a meeting that
 * recorded perfectly (2026-07-21 GA/Leap Metrics: recording done, transcript
 * FAILED, zero documents). Nothing in gracie consumes a live stream — the
 * pipeline only reacts to the post-meeting `transcript.done` webhook — so
 * streaming bought nothing but that failure mode. Async transcribes the
 * completed recording afterwards and fires the same `transcript.done` event.
 * Mapping ALL `recallai` values here (including ones stored in `bot_config`
 * before this fix) means no stale settings row can silently keep streaming.
 * (`mode` is a streaming-only option; async does not accept it.)
 * Exported for unit tests (pure).
 */
export function buildTranscriptProviderConfig(
  provider: RecallTranscriptProvider,
): Record<string, unknown> {
  switch (provider) {
    case 'meeting_captions':
      return { meeting_captions: {} };
    case 'recallai':
      return { recallai_async: { language_code: 'auto' } };
  }
}

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

/**
 * A transcript segment as returned by the current Recall transcript download URL
 * (docs: download-schemas). One entry per participant utterance:
 * `{ participant: { name }, words: [{ text }] }`. The legacy flat `speaker`/`text`
 * shape is still tolerated defensively.
 */
interface RecallTranscriptSegment {
  readonly participant?: { readonly id?: number | null; readonly name?: string | null } | null;
  readonly speaker?: string | null;
  readonly text?: string | null;
  readonly words?: ReadonlyArray<{ readonly text?: string | null }> | null;
}

const DEFAULT_REGION = 'us-west-2';

function baseUrl(region: string | undefined): string {
  return `https://${region ?? DEFAULT_REGION}.recall.ai/api/v1`;
}

/** Resolve a segment's speaker label from the current or legacy shape. */
function segmentSpeaker(segment: RecallTranscriptSegment): string {
  const name = segment.participant?.name;
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  const id = segment.participant?.id;
  if (typeof id === 'number') return `Speaker ${id}`;
  const speaker = segment.speaker;
  return typeof speaker === 'string' ? speaker.trim() : '';
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
  const speaker = segmentSpeaker(segment);
  return speaker !== '' ? `${speaker}: ${text}` : text;
}

/**
 * Flatten Recall's transcript array (`[{ participant, words }]`) into
 * `Speaker: words…` lines. Pure; exported for unit tests. Non-array input yields
 * an empty string (the caller treats empty as "not ready / no speech").
 */
export function flattenRecallTranscript(segments: unknown): string {
  if (!Array.isArray(segments)) return '';
  return (segments as RecallTranscriptSegment[])
    .map(segmentToLine)
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Dispatch a Recall bot into a meeting (docs/07 §1). Creates the bot via
 * `POST /bot` with the meeting's join URL AND a `recording_config.transcript`
 * provider so Recall produces a transcript; returns the Recall bot id, which the
 * caller stores as `meetings.bot_job_id`. When the transcript is ready Recall
 * fires the `transcript.done` webhook — which matches the meeting by that
 * `bot_job_id` and runs generation. P4's job ends here.
 *
 * Throws on a non-OK response so the caller decides how to recover: the worker
 * cron retries the next sweep, and the on-demand join route rolls back the
 * just-created meeting row so a failed dispatch is never silently dropped.
 */
export async function dispatchRecallBot(options: RecallDispatchOptions): Promise<string> {
  // Always request a transcript — omitting this is the bug that left real bots
  // un-transcribed (media_shortcuts.transcript stayed null).
  const provider = options.transcriptProvider ?? DEFAULT_TRANSCRIPT_PROVIDER;
  const body: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName ?? DEFAULT_BOT_NAME,
    recording_config: {
      transcript: { provider: buildTranscriptProviderConfig(provider) },
    },
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
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Recall bot dispatch failed for ${options.meetingUrl} (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { id?: string };
  if (typeof data.id !== 'string' || data.id === '') {
    throw new Error('Recall bot dispatch response had no bot id');
  }
  return data.id;
}

/** Bot-retrieve response subset we depend on (docs: bot_retrieve). */
interface RecallBotRecordings {
  readonly recordings?: ReadonlyArray<{
    readonly media_shortcuts?: {
      readonly transcript?: {
        readonly status?: { readonly code?: string | null } | null;
        readonly data?: { readonly download_url?: string | null } | null;
      } | null;
    } | null;
  }> | null;
}

/** Pull the first ready transcript download URL out of a bot-retrieve payload. */
function findTranscriptDownloadUrl(bot: RecallBotRecordings): string | null {
  for (const recording of bot.recordings ?? []) {
    const transcript = recording?.media_shortcuts?.transcript;
    const url = transcript?.data?.download_url;
    if (transcript?.status?.code === 'done' && typeof url === 'string' && url !== '') {
      return url;
    }
  }
  return null;
}

/**
 * Fetch and flatten the transcript for a Recall bot job, using the CURRENT API
 * (the v1 `/bot/{id}/transcript/` route is legacy). Steps:
 *   1. GET `/bot/{id}/` and find `recordings[].media_shortcuts.transcript` with
 *      `status.code === 'done'` and a `data.download_url`.
 *   2. GET that download URL (a token/presigned URL — sent WITHOUT the Recall
 *      auth header) and flatten the `[{ participant, words }]` array.
 *
 * Throws on a non-OK response, a not-yet-ready transcript, or an empty result so
 * the caller (BullMQ) retries transient/timing failures with backoff.
 */
export async function fetchRecallTranscript(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<string> {
  const botRes = await fetch(`${baseUrl(options.region)}/bot/${botJobId}/`, {
    headers: { Authorization: `Token ${options.apiKey}`, Accept: 'application/json' },
  });
  if (!botRes.ok) {
    const body = await botRes.text().catch(() => '');
    throw new Error(
      `Recall bot fetch failed for bot ${botJobId} (HTTP ${botRes.status}): ${body.slice(0, 300)}`,
    );
  }
  const bot = (await botRes.json()) as RecallBotRecordings;
  const downloadUrl = findTranscriptDownloadUrl(bot);
  if (downloadUrl === null) {
    throw new Error(
      `Recall transcript for bot ${botJobId} is not ready (no completed transcript in media_shortcuts)`,
    );
  }

  // The download URL carries its own token/signature — do NOT add the Recall auth
  // header (a presigned S3 URL would reject a second credential).
  const dlRes = await fetch(downloadUrl, { headers: { Accept: 'application/json' } });
  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => '');
    throw new Error(
      `Recall transcript download failed for bot ${botJobId} (HTTP ${dlRes.status}): ${body.slice(0, 300)}`,
    );
  }
  const segments = (await dlRes.json()) as unknown;
  const transcript = flattenRecallTranscript(segments);
  if (transcript.trim() === '') {
    throw new Error(`Recall transcript for bot ${botJobId} was empty`);
  }
  return transcript;
}
