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
 *
 * RECORDED MEDIA (meeting page player): the VIDEO is never stored on our infra —
 * `fetchRecallRecordingUrls` reads the bot for FRESH signed URLs and the browser
 * streams the mixed-video MP4 DIRECTLY from Recall's S3 (native seeking; the URL
 * expires ~5h, so it's fetched per view). The TRANSCRIPT does both: the worker keeps
 * a durable copy (segments via `fetchRecallMedia`, readable doc from the flattened
 * transcript), and the page live-pulls + caches it for back-catalog meetings via
 * `downloadRecallTranscript`.
 */
import type { TranscriptSegment } from '../types/meeting.js';

export * from './voice-commands.js';

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
  /**
   * Phase D live transcript. When set (non-empty), the bot streams realtime
   * utterances to this webhook URL via `recording_config.realtime_endpoints`, and
   * a STREAMING transcript provider is attached (Recall requires one for realtime).
   * Omit / null for the record-only default. See {@link buildRecordingConfig}.
   */
  readonly realtimeTranscriptUrl?: string | null;
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
 * Streaming transcript provider used for realtime (Phase D). `recallai_streaming`
 * is Recall's own live ASR, independent of the meeting platform's caption
 * settings. When the operator selected `meeting_captions`, realtime rides the
 * platform's live captions instead (no extra ASR cost). Both emit `transcript.data`.
 *
 * ⚠️ Enabling realtime SUPERSEDES the async transcript for that bot: Recall allows
 * ONE transcript provider per recording, so the recording's transcript becomes the
 * streaming one and `transcript.done` fires off it (not `recallai_async`). Phase C
 * still works — it renders whatever transcript the recording carries. Kept behind a
 * default-OFF kill-switch so this only happens when an admin opts in.
 */
function realtimeProviderConfig(provider: RecallTranscriptProvider): Record<string, unknown> {
  return provider === 'meeting_captions' ? { meeting_captions: {} } : { recallai_streaming: {} };
}

/**
 * Build the full `recording_config` for a bot (or null to omit it), combining the
 * transcript provider with the optional Phase-D realtime endpoint:
 *   - no realtime + `recallai`         → null (record-only, async transcript later)
 *   - no realtime + `meeting_captions` → `{ transcript: { provider: {...} } }`
 *   - realtime (url set)               → `{ transcript: { provider: <streaming> },
 *       realtime_endpoints: [{ type:'webhook', url, events:['transcript.data'] }] }`
 * Pure; exported for unit tests.
 */
export function buildRecordingConfig(
  provider: RecallTranscriptProvider,
  realtimeTranscriptUrl?: string | null,
): Record<string, unknown> | null {
  const realtime = typeof realtimeTranscriptUrl === 'string' && realtimeTranscriptUrl !== '';
  const transcriptProvider = realtime
    ? realtimeProviderConfig(provider)
    : buildTranscriptProviderConfig(provider);

  const config: Record<string, unknown> = {};
  if (transcriptProvider !== null) config.transcript = { provider: transcriptProvider };
  if (realtime) {
    config.realtime_endpoints = [
      { type: 'webhook', url: realtimeTranscriptUrl, events: ['transcript.data'] },
    ];
  }
  return Object.keys(config).length > 0 ? config : null;
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
interface RecallTranscriptWord {
  readonly text?: string | null;
  /** Seconds from the recording start (Recall's per-word relative timestamp). */
  readonly start_timestamp?: { readonly relative?: number | null } | null;
  readonly end_timestamp?: { readonly relative?: number | null } | null;
}

interface RecallTranscriptSegment {
  readonly participant?: { readonly id?: number | null; readonly name?: string | null } | null;
  readonly speaker?: string | null;
  readonly text?: string | null;
  readonly words?: ReadonlyArray<RecallTranscriptWord> | null;
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

/** A segment's spoken text (no speaker prefix), tolerating either response shape. */
function segmentText(segment: RecallTranscriptSegment): string {
  return typeof segment.text === 'string' && segment.text.trim() !== ''
    ? segment.text.trim()
    : (segment.words ?? [])
        .map((word) => word.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Join one segment into a `Speaker: words…` line, tolerating either response shape. */
function segmentToLine(segment: RecallTranscriptSegment): string {
  const text = segmentText(segment);
  if (text === '') return '';
  const speaker = segmentSpeaker(segment);
  return speaker !== '' ? `${speaker}: ${text}` : text;
}

/** First finite relative timestamp across a segment's words (`which` = start/end edge). */
function edgeTimestamp(
  words: ReadonlyArray<RecallTranscriptWord>,
  which: 'start_timestamp' | 'end_timestamp',
): number | null {
  const ordered = which === 'start_timestamp' ? words : [...words].reverse();
  for (const word of ordered) {
    const t = word[which]?.relative;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Shape Recall's transcript array (`[{ participant, words }]`) into timestamped
 * {@link TranscriptSegment}s for the synced player — `start`/`end` in SECONDS from
 * the recording start (first word's start, last word's end), `null` when the shape
 * carried no timing. Empty/no-speech utterances are dropped. Pure; unit-tested.
 */
export function shapeTranscriptSegments(raw: unknown): TranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptSegment[] = [];
  for (const segment of raw as RecallTranscriptSegment[]) {
    const text = segmentText(segment);
    if (text === '') continue;
    const words = segment.words ?? [];
    out.push({
      start: edgeTimestamp(words, 'start_timestamp'),
      end: edgeTimestamp(words, 'end_timestamp'),
      speaker: segmentSpeaker(segment),
      text,
    });
  }
  return out;
}

/**
 * Shape one realtime `transcript.data` event (Phase D) into a {@link TranscriptSegment}.
 * The event nests the utterance at `data.data` with the SAME `{ participant, words }`
 * shape the async download uses, so it reuses {@link shapeTranscriptSegments}:
 *   `{ event, data: { data: { words, participant, language_code } } }`
 * Returns null for a non-utterance / empty-speech event (dropped, not streamed).
 * Pure; exported for unit tests.
 */
export function parseRealtimeTranscript(raw: unknown): TranscriptSegment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = (raw as Record<string, unknown>).data;
  const inner = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).data : null;
  if (typeof inner !== 'object' || inner === null) return null;
  return shapeTranscriptSegments([inner])[0] ?? null;
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
  const recordingConfig = buildRecordingConfig(provider, options.realtimeTranscriptUrl);
  const body: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName ?? DEFAULT_BOT_NAME,
  };
  if (recordingConfig !== null) {
    body.recording_config = recordingConfig;
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
    readonly started_at?: string | null;
    readonly completed_at?: string | null;
    readonly media_shortcuts?: {
      readonly transcript?: {
        readonly status?: { readonly code?: string | null; readonly sub_code?: string | null } | null;
        readonly data?: { readonly download_url?: string | null } | null;
      } | null;
      /** Mixed (single-tile) recording MP4 — the video the meeting-page player streams. */
      readonly video_mixed?: { readonly data?: { readonly download_url?: string | null } | null } | null;
    } | null;
  }> | null;
}

/** GET `/bot/{id}/` and parse it into the recordings subset we read (shared by fetch/ensure/classify). */
async function retrieveBot(botJobId: string, options: RecallFetchOptions): Promise<RecallBotRecordings> {
  const botRes = await fetch(`${baseUrl(options.region)}/bot/${botJobId}/`, {
    headers: { Authorization: `Token ${options.apiKey}`, Accept: 'application/json' },
  });
  if (!botRes.ok) {
    const body = await botRes.text().catch(() => '');
    throw new Error(
      `Recall bot fetch failed for bot ${botJobId} (HTTP ${botRes.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await botRes.json()) as RecallBotRecordings;
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
  const bot = await retrieveBot(botJobId, options);
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

/** First mixed-video (MP4) download URL in a bot-retrieve payload, else null. Pure. */
export function findVideoMixedUrl(bot: RecallBotRecordings): string | null {
  for (const recording of bot.recordings ?? []) {
    const url = recording?.media_shortcuts?.video_mixed?.data?.download_url;
    if (typeof url === 'string' && url !== '') return url;
  }
  return null;
}

/** Recording length in whole seconds from `started_at`/`completed_at`, else null. */
function recordingDurationS(bot: RecallBotRecordings): number | null {
  for (const recording of bot.recordings ?? []) {
    const start = recording?.started_at;
    const end = recording?.completed_at;
    if (typeof start === 'string' && typeof end === 'string') {
      const ms = Date.parse(end) - Date.parse(start);
      if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 1000);
    }
  }
  return null;
}

/** Recorded-media handles for the meeting-page player ({@link fetchRecallMedia}). */
export interface RecallMedia {
  /** Recall's mixed-video MP4 URL (short-lived, cross-origin) — the worker streams it to MinIO. */
  readonly videoUrl: string | null;
  /** Recording length in seconds (from Recall metadata), else null. */
  readonly durationS: number | null;
  /** Timestamped transcript utterances for the synced player (empty if none ready). */
  readonly segments: TranscriptSegment[];
}

/**
 * Read one bot's recorded media (meeting page Phase C): the mixed-video MP4 URL +
 * the transcript shaped into timestamped {@link TranscriptSegment}s, from a single
 * bot-retrieve. Best-effort by design — a missing video or not-yet-ready transcript
 * yields `null`/`[]` rather than throwing (only the bot fetch itself throws, so a
 * transient network error still surfaces to the caller's retry/log). The MP4 URL is
 * NOT downloaded here — the worker streams it into MinIO so this module stays
 * storage-free.
 */
export async function fetchRecallMedia(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<RecallMedia> {
  const bot = await retrieveBot(botJobId, options);
  const videoUrl = findVideoMixedUrl(bot);
  const durationS = recordingDurationS(bot);

  let segments: TranscriptSegment[] = [];
  const downloadUrl = findTranscriptDownloadUrl(bot);
  if (downloadUrl !== null) {
    // Presigned/token URL — no Recall auth header (a second credential 400s S3).
    const dlRes = await fetch(downloadUrl, { headers: { Accept: 'application/json' } });
    if (dlRes.ok) segments = shapeTranscriptSegments((await dlRes.json()) as unknown);
  }
  return { videoUrl, durationS, segments };
}

/** Fresh Recall download URLs for the meeting-page player (live-pull; nothing stored). */
export interface RecallRecordingUrls {
  /** Mixed-video MP4 URL (signed, ~5h) — streamed DIRECTLY by the browser, never stored. */
  readonly videoUrl: string | null;
  /** Transcript download URL (signed) — null until the transcript is ready. */
  readonly transcriptUrl: string | null;
  /** Recording length in seconds (Recall metadata), else null. */
  readonly durationS: number | null;
}

/**
 * Read one bot's FRESH recorded-media URLs from a single bot-retrieve — the mixed
 * video (streamed straight from Recall's S3 to the browser, never stored on our
 * infra) and the transcript download URL. Only the bot fetch itself throws (a
 * transient network error surfaces to the caller); a missing recording / not-ready
 * transcript simply yields null. Nothing is downloaded here.
 */
export async function fetchRecallRecordingUrls(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<RecallRecordingUrls> {
  const bot = await retrieveBot(botJobId, options);
  return {
    videoUrl: findVideoMixedUrl(bot),
    transcriptUrl: findTranscriptDownloadUrl(bot),
    durationS: recordingDurationS(bot),
  };
}

/**
 * Download a Recall transcript by its (signed) download URL and shape it BOTH ways in
 * one fetch: timestamped {@link TranscriptSegment}s for the click-to-seek player, and
 * a flattened `Speaker: words` transcript for the readable, durable document. Returns
 * null on a non-OK response (best-effort — the caller degrades to "no transcript").
 * The URL carries its own token, so no Recall auth header (a second credential 400s S3).
 */
export async function downloadRecallTranscript(
  transcriptUrl: string,
): Promise<{ readonly segments: TranscriptSegment[]; readonly text: string } | null> {
  const res = await fetch(transcriptUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const raw = (await res.json()) as unknown;
  return { segments: shapeTranscriptSegments(raw), text: flattenRecallTranscript(raw) };
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

/**
 * POST a no-body bot lifecycle action (leave / pause / resume). Shared by
 * {@link leaveRecallBot}/{@link pauseRecallBot}/{@link resumeRecallBot}; mirrors
 * {@link createRecallAsyncTranscript}'s auth + throw-on-non-OK shape. These are
 * pure Recall bot-API calls — they act on ANY bot regardless of the transcript
 * provider, and touch nothing about the realtime/transcript config.
 */
async function postBotAction(
  botJobId: string,
  action: 'leave_call' | 'pause_recording' | 'resume_recording',
  options: RecallFetchOptions,
): Promise<void> {
  const res = await fetch(`${baseUrl(options.region)}/bot/${botJobId}/${action}/`, {
    method: 'POST',
    headers: { Authorization: `Token ${options.apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Recall bot ${action} failed for bot ${botJobId} (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
}

/**
 * Make Gracie's bot LEAVE the call now (docs: bot/leave_call). Irreversible — the
 * bot will not rejoin — so the caller confirms first. Throws on a non-OK response.
 */
export async function leaveRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'leave_call', options);
}

/**
 * PAUSE the bot's recording (docs: bot/pause_recording). The bot stays in the call
 * but stops capturing until {@link resumeRecallBot}. Throws on a non-OK response.
 */
export async function pauseRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'pause_recording', options);
}

/** RESUME a paused bot's recording (docs: bot/resume_recording). Throws on a non-OK response. */
export async function resumeRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'resume_recording', options);
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
  const bot = await retrieveBot(botJobId, options);
  const recordings = bot.recordings ?? [];
  if (recordings.some((r) => r?.media_shortcuts?.transcript != null)) return 'already_requested';
  const recordingId = recordings.map((r) => r?.id).find((id) => typeof id === 'string' && id !== '');
  if (recordingId == null) return 'no_recording';
  await createRecallAsyncTranscript(recordingId as string, options);
  return 'created';
}

/**
 * Three-way recoverability of a stuck meeting (brief §3.2). Drives BOTH the
 * self-heal watchdog (which action to take unattended) AND the Pipeline
 * fleet-view row action (which button, if any, to offer a non-technical staffer):
 *   - `regenerate`    — a completed transcript exists on Recall; just re-run generation.
 *   - `retranscribe`  — no usable transcript (missing or `status=failed`) but a
 *                       recording DOES exist → request async transcription, then generate.
 *                       This is the GA/Leap Metrics `provider_connection_failed` case.
 *   - `unrecoverable` — no recording at all (silent / never-admitted bot) → nothing to recover.
 */
export type RecallRecoveryState = 'regenerate' | 'retranscribe' | 'unrecoverable';

export interface RecallRecoverability {
  readonly state: RecallRecoveryState;
  /** Recording id to re-transcribe from — present iff `state === 'retranscribe'`. */
  readonly recordingId: string | null;
  /**
   * True when an async transcript is already in flight (`status=processing`), so a
   * caller should WAIT rather than request another one. Only meaningful for `retranscribe`.
   */
  readonly transcriptPending: boolean;
  /** Raw provider/status code (e.g. `provider_connection_failed`) for a support tooltip — never a UI headline. */
  readonly detail: string | null;
}

/** Transcript status codes that mean "still working" — a request is in flight, don't re-issue. */
function isPendingTranscriptCode(code: string | null | undefined): boolean {
  return code === 'processing' || code === 'in_progress';
}

/**
 * Classify a bot-retrieve payload into {@link RecallRecoverability}. PURE and
 * exported for unit tests — the async {@link classifyRecallRecoverability} just
 * fetches the bot and calls this.
 */
export function classifyRecordings(bot: RecallBotRecordings): RecallRecoverability {
  const recordings = bot.recordings ?? [];
  let recordingId: string | null = null;
  let pending = false;
  let detail: string | null = null;

  for (const recording of recordings) {
    const transcript = recording?.media_shortcuts?.transcript;
    const code = transcript?.status?.code ?? null;
    const url = transcript?.data?.download_url;
    // A completed, downloadable transcript → the transcript is fine; re-run generation.
    if (code === 'done' && typeof url === 'string' && url !== '') {
      return { state: 'regenerate', recordingId: recording?.id ?? null, transcriptPending: false, detail: null };
    }
    if (isPendingTranscriptCode(code)) pending = true;
    // Surface the failure sub_code (e.g. provider_connection_failed) for support.
    if (code === 'failed') detail = transcript?.status?.sub_code ?? code;
    const id = recording?.id;
    if (recordingId === null && typeof id === 'string' && id !== '') recordingId = id;
  }

  // A recording exists but no usable transcript → re-transcribe the recording.
  if (recordingId !== null) {
    return { state: 'retranscribe', recordingId, transcriptPending: pending, detail };
  }
  // No recording at all → nothing to recover from.
  return { state: 'unrecoverable', recordingId: null, transcriptPending: false, detail };
}

/**
 * Recall pre-flight: fetch the bot and classify its recoverability
 * ({@link classifyRecordings}). Used by the self-heal watchdog and the Pipeline
 * fleet view so neither offers a recovery action guaranteed to fail (brief §6).
 */
export async function classifyRecallRecoverability(
  botJobId: string,
  options: RecallFetchOptions,
): Promise<RecallRecoverability> {
  return classifyRecordings(await retrieveBot(botJobId, options));
}

// ── In-meeting bot controls (voice commands) ────────────────────────────────
// Four thin POSTs mirroring createRecallAsyncTranscript above: same auth header,
// same throw-on-non-OK contract. Used by the voice-command path — a participant
// says "hey Gracie, leave / stop listening" and the transcript webhook fires one
// of these. Kept here so the SAME definitions serve a sibling bot-controls PR
// (expected overlap — identical signatures).

/** POST a bot control action with the standard Recall auth header; throws on non-OK. */
async function postBotAction(
  botJobId: string,
  action: string,
  options: RecallFetchOptions,
  body?: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(`${baseUrl(options.region)}/bot/${botJobId}/${action}/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Recall ${action} failed for bot ${botJobId} (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
    );
  }
  return res;
}

/** Make the bot leave the call now (`POST /bot/{id}/leave_call/`). Throws on non-OK. */
export async function leaveRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'leave_call', options);
}

/** Pause the bot's recording (`POST /bot/{id}/pause_recording/`). Throws on non-OK. */
export async function pauseRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'pause_recording', options);
}

/**
 * Resume the bot's recording (`POST /bot/{id}/resume_recording/`). Throws on non-OK
 * like its siblings; the resume PROCESSOR treats a failure as a harmless no-op
 * (by the time a delayed resume fires the bot may have already resumed or left).
 */
export async function resumeRecallBot(botJobId: string, options: RecallFetchOptions): Promise<void> {
  await postBotAction(botJobId, 'resume_recording', options);
}

/** Options for {@link sendRecallChatMessage} — Recall's in-meeting chat targeting. */
export interface RecallChatOptions extends RecallFetchOptions {
  /** `everyone` (default) or a specific participant id (`to` in Recall's API). */
  readonly to?: string;
}

/**
 * Post a message into the meeting's chat as the bot
 * (`POST /bot/{id}/send_chat_message/`). Used to visibly CONFIRM a voice command
 * before acting on it, so a spoken "leave" / "pause" never happens silently.
 * Throws on non-OK.
 */
export async function sendRecallChatMessage(
  botJobId: string,
  text: string,
  options: RecallChatOptions,
): Promise<void> {
  const body: Record<string, unknown> = { message: text };
  if (typeof options.to === 'string' && options.to !== '') body.to = options.to;
  await postBotAction(botJobId, 'send_chat_message', options, body);
}
