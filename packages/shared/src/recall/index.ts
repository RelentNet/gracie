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
 * TRANSCRIPTION: `meeting_captions` bots carry their transcript config at
 * create; `recallai` (async ASR, the default) bots record only, and the
 * `recording.done` webhook calls `ensureAsyncTranscript` to request the
 * transcript on the finished recording — our account's create-bot API rejects
 * `recallai_async`, and the streaming provider is the one that failed a real
 * client meeting (see `buildTranscriptProviderConfig`). The provider is tunable
 * at dispatch (Settings → Meeting Bot → `getBotConfig`).
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
   * Transcription provider selector. Omitted → {@link DEFAULT_TRANSCRIPT_PROVIDER}.
   * `meeting_captions` is sent as `recording_config.transcript`; `recallai`
   * dispatches record-only (the transcript is requested post-recording — see
   * the module header).
   */
  readonly transcriptProvider?: RecallTranscriptProvider;
}

const DEFAULT_BOT_NAME = 'Gracie';

/**
 * Map our provider selector to Recall's `recording_config.transcript.provider`
 * wire shape at BOT CREATION (docs: recallai-transcription):
 *   - meeting_captions → `{ meeting_captions: {} }`
 *   - recallai         → `null` — no transcript config at create (record-only)
 *
 * `recallai` means Recall's ASYNC ASR, but our account's create-bot API does
 * NOT accept `recallai_async` (verified live 2026-07-22: HTTP 400, allowed list
 * is streaming providers + meeting_captions only). And `recallai_streaming` is
 * the provider that failed with `provider_connection_failed` and cost the
 * 2026-07-21 GA/Leap Metrics meeting its documents. So for `recallai` the bot
 * records WITHOUT a transcript config, and when Recall fires `recording.done`
 * the webhook requests the async transcript on the finished recording via
 * {@link ensureAsyncTranscript} — the flow Recall documents for post-meeting
 * transcription, and the one proven to work on this account (the Leap Metrics
 * recovery). `transcript.done` then drives generation exactly as before.
 * Exported for unit tests (pure).
 */
export function buildTranscriptProviderConfig(
  provider: RecallTranscriptProvider,
): Record<string, unknown> | null {
  switch (provider) {
    case 'meeting_captions':
      return { meeting_captions: {} };
    case 'recallai':
      return null;
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
 * `POST /bot` with the meeting's join URL; returns the Recall bot id, which the
 * caller stores as `meetings.bot_job_id`. Transcription: `meeting_captions` is
 * configured at create; `recallai` bots record only, and the `recording.done`
 * webhook requests the async transcript ({@link ensureAsyncTranscript}). When
 * the transcript is ready Recall fires the `transcript.done` webhook — which
 * matches the meeting by that `bot_job_id` and runs generation.
 *
 * Throws on a non-OK response so the caller decides how to recover: the worker
 * cron retries the next sweep, and the on-demand join route rolls back the
 * just-created meeting row so a failed dispatch is never silently dropped.
 */
export async function dispatchRecallBot(options: RecallDispatchOptions): Promise<string> {
  // meeting_captions carries its transcript config at create; recallai bots are
  // record-only here — the recording.done webhook requests the async transcript
  // (see buildTranscriptProviderConfig for why create-bot can't).
  const provider = options.transcriptProvider ?? DEFAULT_TRANSCRIPT_PROVIDER;
  const providerConfig = buildTranscriptProviderConfig(provider);
  const body: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName ?? DEFAULT_BOT_NAME,
  };
  if (providerConfig !== null) {
    body.recording_config = { transcript: { provider: providerConfig } };
  }

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
    readonly id?: string | null;
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

/**
 * Request Recall's async ASR on a finished recording (docs: async-transcription):
 * `POST /recording/{id}/create_transcript/` with `recallai_async`. This is the
 * ONLY way our account gets Recall's own transcription — create-bot rejects
 * `recallai_async` (see buildTranscriptProviderConfig). When the transcript
 * finishes, Recall fires `transcript.done` and generation proceeds as usual.
 * Throws on a non-OK response so the webhook 500s and Svix retries.
 */
export async function createRecallAsyncTranscript(
  recordingId: string,
  options: RecallFetchOptions,
): Promise<void> {
  const res = await fetch(`${baseUrl(options.region)}/recording/${recordingId}/create_transcript/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      provider: { recallai_async: { language_code: 'auto' } },
      // Per-participant audio streams give real speaker names in the transcript.
      diarization: { use_separate_streams_when_available: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Recall create_transcript failed for recording ${recordingId} (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
}

/** Outcome of {@link ensureAsyncTranscript}, for webhook logging/response. */
export type EnsureAsyncTranscriptResult = 'created' | 'already_requested' | 'no_recording';

/**
 * Idempotently make sure a bot's finished recording has a transcript coming:
 * GET the bot; if any recording already carries a transcript (done, processing,
 * or requested at create — e.g. meeting_captions), do nothing; otherwise request
 * the async transcript on the first recording. Called from the `recording.done`
 * webhook, whose Svix retries make the idempotence necessary.
 */
export async function ensureAsyncTranscript(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<EnsureAsyncTranscriptResult> {
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
  const recordings = bot.recordings ?? [];
  if (recordings.some((r) => r?.media_shortcuts?.transcript != null)) return 'already_requested';
  const recordingId = recordings.map((r) => r?.id).find((id) => typeof id === 'string' && id !== '');
  if (recordingId == null) return 'no_recording';
  await createRecallAsyncTranscript(recordingId as string, options);
  return 'created';
}
