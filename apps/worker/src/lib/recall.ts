/**
 * Recall.ai transcript fetch (docs/07 §3). Used by the meeting generation
 * processor when no `transcriptOverride` is supplied: given a `bot_job_id` and the
 * resolved Recall API key (via `getCredential('recall')`), fetch the completed
 * transcript and flatten it to plain text for embedding + generation.
 *
 * DEPLOY-TIME FOLLOW-UP (do not block on this — see the P5b brief's Escalate §):
 * the webhook + live transcript endpoint are not registered with Recall until
 * deploy, so the P5b pipeline is proven end-to-end via `transcriptOverride`.
 * During P5b verification the live key reached Recall but reported that the v1
 * `/bot/{id}/transcript/` route below is now LEGACY ("please use the updated
 * endpoint": https://docs.recall.ai/reference/transcript_retrieve). Wiring the
 * modern transcript_retrieve flow (resolve the transcript id from the bot's
 * recording → fetch its download URL → parse) needs a real bot payload to test
 * against, so it is deferred to deploy. Kept dependency-free (`fetch`, no SDK) to
 * mirror the provider adapters; swap the URL + parser when the endpoint is wired.
 */

export interface RecallFetchOptions {
  readonly apiKey: string;
  /** Recall region subdomain (env `RECALL_REGION`); defaults to `us-west-2`. */
  readonly region?: string;
}

/** Options for dispatching a Recall bot into a meeting (P4, docs/07 §1). */
export interface RecallDispatchOptions extends RecallFetchOptions {
  /** The join URL the bot dials into (`meetings.video_link`). */
  readonly meetingUrl: string;
  /** Display name the bot joins as (shown to human attendees). */
  readonly botName?: string;
}

const DEFAULT_BOT_NAME = 'Grace & Associates Notetaker';

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
 * Throws on a non-OK response so the caller (BullMQ) retries transient failures
 * with backoff; the bot-dispatch processor only marks `bot_dispatched=true` after
 * this resolves, so a failed dispatch is retried, never silently dropped.
 */
export async function dispatchRecallBot(options: RecallDispatchOptions): Promise<string> {
  const res = await fetch(`${baseUrl(options.region)}/bot/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      meeting_url: options.meetingUrl,
      bot_name: options.botName ?? DEFAULT_BOT_NAME,
    }),
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
