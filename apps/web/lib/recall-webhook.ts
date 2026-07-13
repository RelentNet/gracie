/**
 * Recall.ai webhook verification + payload parsing (docs/05 Webhooks, docs/07 §3).
 *
 * Recall delivers webhooks through Svix, so signatures follow the Svix scheme:
 *   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   expected      = base64( HMAC-SHA256( secretBytes, signedContent ) )
 * where `secretBytes` is the base64 payload of the `whsec_…` secret. The
 * `svix-signature` header is a space-separated list of `v<n>,<sig>` entries; the
 * request is valid if ANY entry matches (constant-time compare).
 *
 * The signing logic is a PURE function so it can be unit-tested without HTTP. The
 * webhook secret (`RECALL_WEBHOOK_SECRET`) is not provisioned until the endpoint
 * is registered with Recall at deploy — see the route for the skip-with-warning
 * behavior used until then.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The three Svix headers required to verify a webhook. */
export interface SvixHeaders {
  readonly id: string;
  readonly timestamp: string;
  readonly signature: string;
}

/** Decode the signing key bytes from a `whsec_<base64>` (or bare base64) secret. */
function secretBytes(secret: string): Buffer {
  const base64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(base64, 'base64');
}

/** Constant-time compare of two base64 signatures. */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'base64');
  const bufB = Buffer.from(b, 'base64');
  return bufA.length === bufB.length && bufA.length > 0 && timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Svix-signed webhook. Returns true iff one of the provided signatures
 * matches the HMAC of `${id}.${timestamp}.${body}` under `secret`.
 */
export function verifyRecallSignature(
  secret: string,
  headers: SvixHeaders,
  body: string,
): boolean {
  if (secret === '' || headers.id === '' || headers.timestamp === '' || headers.signature === '') {
    return false;
  }
  const signedContent = `${headers.id}.${headers.timestamp}.${body}`;
  const expected = createHmac('sha256', secretBytes(secret)).update(signedContent).digest('base64');

  // Header form: "v1,<sig> v1,<sig2>"; the version prefix is comma-separated.
  return headers.signature
    .split(' ')
    .map((part) => {
      const comma = part.indexOf(',');
      return comma === -1 ? part : part.slice(comma + 1);
    })
    .some((candidate) => signaturesMatch(candidate, expected));
}

/**
 * The webhook event Recall emits once a bot's transcript has finished and is
 * fetchable (docs: real-time event payloads). Its payload carries `data.bot.id`,
 * so the route can match the meeting by `bot_job_id` exactly as before. This is
 * the ONLY event that should trigger generation — earlier bot-status events
 * (`bot.done`, etc.) fire before the transcript exists.
 */
export const RECALL_TRANSCRIPT_DONE_EVENT = 'transcript.done';

/** True for the webhook event that signals the transcript is ready to fetch. */
export function isTranscriptReadyEvent(event: string | null): boolean {
  return event === RECALL_TRANSCRIPT_DONE_EVENT;
}

/** Result of parsing a Recall webhook body. */
export interface RecallWebhookEvent {
  readonly event: string | null;
  /** The `bot_job_id` to match against a meeting, when present. */
  readonly botJobId: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Pull the event name + bot id out of a Recall webhook payload, tolerating the
 * shapes Recall has used (`data.bot.id`, `data.bot_id`, top-level `bot_id`).
 */
export function parseRecallWebhook(raw: unknown): RecallWebhookEvent {
  if (typeof raw !== 'object' || raw === null) return { event: null, botJobId: null };
  const root = raw as Record<string, unknown>;
  const data = (typeof root.data === 'object' && root.data !== null ? root.data : {}) as Record<
    string,
    unknown
  >;
  const bot = (typeof data.bot === 'object' && data.bot !== null ? data.bot : {}) as Record<
    string,
    unknown
  >;

  const botJobId =
    readString(bot.id) ??
    readString(data.bot_id) ??
    readString(root.bot_id) ??
    readString(data.bot_job_id) ??
    readString(root.bot_job_id);

  return { event: readString(root.event) ?? readString(root.type), botJobId };
}
