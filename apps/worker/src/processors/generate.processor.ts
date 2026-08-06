/**
 * Meeting generation processor (P5b, docs/06 §4). For one ended meeting:
 *
 *   transcript (override or Recall fetch) → store in MinIO → embed → retrieve
 *   historical context → generate the 6 docs SEQUENTIALLY (D7) → store + insert
 *   `documents` rows → parse Task Checklist → insert `tasks` → append a
 *   `master_record_entries` digest → record a `pipeline_runs` row → mark the
 *   meeting `complete` → notify attendees in-app.
 *
 * AI ONLY through the provider interface (`getActiveProvider`/`getEmbedder`, D11);
 * embeddings pinned 1536-dim (D9). Documents 3 (client_summary) & 6 (client_email)
 * are `requires_review` and NEVER auto-sent (docs/06 §3). The generation itself
 * lives in the reusable `lib/generate.ts` core so the upload path can reuse it.
 *
 * Failure handling (docs/06 §8): transient AI/storage errors throw → BullMQ
 * retries with backoff; on the FINAL attempt the meeting is flagged
 * `needs_attention` and a `failed` `pipeline_runs` row is written.
 */
import { createHash } from 'node:crypto';

import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import {
  findOrCreateFolder,
  getActiveProvider,
  getBotConfig,
  getCredential,
  getEmbedder,
  getServerClient,
} from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import {
  EMBEDDING_DIMENSIONS,
  deriveInitialsFromName,
  deriveOrgNameFromDomain,
  emailDomain,
  isFreeEmailDomain,
  parseInternalDomains,
  resolveGenerationPrompts,
  type ExternalAttendee,
  type ExtractedTask,
  type GeneratedDocType,
  type GenerationJobPayload,
} from '@gracie/shared';
import { getObjectBytes, putObject } from '@gracie/shared/storage';

import { chunkText } from '../lib/chunk.js';
import { emailAdminsForAlert } from '../lib/email.js';
import { generateDocuments, type GeneratedDocument } from '../lib/generate.js';
import {
  fetchRecallMedia,
  fetchRecallParticipants,
  fetchRecallTranscript,
  type RecallMedia,
  type RecallParticipant,
} from '../lib/recall.js';
import { extractScreenShareStills } from '../lib/stills.js';
import {
  decideCapEvictions,
  decideTaskUpsert,
  findDuplicateTask,
  resolveTaskOwner,
} from '../lib/task-lifecycle.js';
import { easternDateString, easternStamp } from './daily-sync.processor.js';

type DocumentTypeEnum = Database['public']['Enums']['document_type'];
type PipelineStatus = Database['public']['Enums']['pipeline_status'];
type MeetingRow = Database['public']['Tables']['meetings']['Row'];
type ClientRow = Database['public']['Tables']['clients']['Row'];
type EmbeddingInsert = Database['public']['Tables']['embeddings']['Insert'];
type DocumentInsert = Database['public']['Tables']['documents']['Insert'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];
type MeetingMediaInsert = Database['public']['Tables']['meeting_media']['Insert'];
type MeetingStillInsert = Database['public']['Tables']['meeting_stills']['Insert'];

/** Outcome of a generation run (returned to BullMQ; visible in Bull Board). */
export interface GenerateResult {
  readonly meetingId: string;
  readonly documents: number;
  readonly tasks: number;
  /** `skipped` = benign terminal state (no client to file under — nothing to generate). */
  readonly status: 'success' | 'partial' | 'skipped';
}

/**
 * How to handle a meeting's client at generation time (root cause #2). `generate`
 * used to HARD-THROW when `client_id` was null, turning ad-hoc/test meetings AND
 * internal GA meetings (inconsistently assigned) into red pipeline failures:
 *   - `proceed`  — a client is set; generate under it.
 *   - `assign`   — no client but the meeting is internal AND a GA internal org exists →
 *                  reliably home it to GA so internal meetings DO generate (fixes the
 *                  "Allie & Daniel" inconsistency).
 *   - `skip`     — genuinely client-less (unassigned external / ad-hoc / test, or internal
 *                  with no GA org) → DEFER doc generation but still capture the transcript
 *                  (benign "Recorded — link a client…" state, not a failed run); generation
 *                  auto-runs once a client is linked (generate-on-link).
 * Pure + exported for unit tests.
 */
export type ClientResolution =
  | { readonly kind: 'proceed'; readonly clientId: string }
  | { readonly kind: 'assign'; readonly clientId: string }
  | { readonly kind: 'skip' };

export function resolveMeetingClientId(
  meeting: { readonly client_id: string | null; readonly is_internal: boolean },
  internalOrgId: string | null,
): ClientResolution {
  if (meeting.client_id !== null && meeting.client_id !== '') {
    return { kind: 'proceed', clientId: meeting.client_id };
  }
  if (meeting.is_internal && internalOrgId !== null && internalOrgId !== '') {
    return { kind: 'assign', clientId: internalOrgId };
  }
  return { kind: 'skip' };
}

/** A participant considered by the attendance gate (a display name and/or an email). */
export interface AttendanceParticipant {
  readonly name: string | null;
  readonly email: string | null;
}

/** Why a recording is skipped as "no real meeting" (ghost-meeting attendance gate). */
export type NoShowReason = 'too_few_participants' | 'no_internal_participant';

export type AttendanceGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: NoShowReason };

/**
 * Ghost-meeting attendance gate (root cause: stale/duplicate calendar entries — the
 * InterSystems ghost — send a bot into a call that never really happens). A recording
 * counts as a REAL meeting only when at least two DISTINCT people actually joined AND
 * at least one is internal/GA. Gate on *did the meeting happen*, NEVER on whether a
 * client is linked — a real-but-unlinked meeting still proceeds (generate-on-link
 * fills in its notes once a client is set). The caller excludes Gracie's own bot
 * before calling this, so the ≥2 bar counts real humans. Pure; unit-tested.
 */
export function decideAttendanceGate(
  participants: readonly AttendanceParticipant[],
  isInternal: (participant: AttendanceParticipant) => boolean,
): AttendanceGate {
  // Distinct real people only: drop blanks; dedupe on name+email (a rejoin lists twice).
  const seen = new Set<string>();
  const distinct: AttendanceParticipant[] = [];
  for (const p of participants) {
    const name = (p.name ?? '').trim();
    const email = (p.email ?? '').trim().toLowerCase();
    if (name === '' && email === '') continue;
    const dedupeKey = `${name.toLowerCase()}|${email}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    distinct.push(p);
  }
  if (distinct.length < 2) return { ok: false, reason: 'too_few_participants' };
  if (!distinct.some((p) => isInternal(p))) return { ok: false, reason: 'no_internal_participant' };
  return { ok: true };
}

/**
 * Plain-language reason recorded when a meeting is recorded but has no client yet —
 * written to `pipeline_runs.error_message` with status left null (an explanation, not
 * a failure, so the Pipeline view + meeting page show it as a benign row, never a red
 * error). The transcript IS captured; only doc generation waits for a client, which
 * is auto-enqueued the moment one is linked (see generate-on-link, apps/web).
 */
const NO_CLIENT_SKIP_REASON = 'Recorded — link a client to generate its notes.';

/**
 * MinIO key for the durable transcript copy of a recorded-but-not-yet-linked meeting.
 * Client-independent (no slug), keyed by meeting id so a later generate-on-link run can
 * fall back to it if Recall's retention lapsed before the client was linked. Exported
 * for the unit test.
 */
export function unlinkedTranscriptKey(meetingId: string): string {
  return `unlinked/${meetingId}/transcript.txt`;
}

/** `GeneratedDocType` → the `document_type` enum (emails differ — see docs/06 §5 mapping). */
const DOC_TYPE_TO_ENUM: Record<GeneratedDocType, DocumentTypeEnum> = {
  post_meeting_analysis: 'post_meeting_analysis',
  internal_memo: 'internal_memo',
  client_summary: 'client_summary',
  task_checklist: 'task_checklist',
  internal_email: 'internal_email_draft',
  client_email: 'client_email_draft',
};

/** Max chunks embedded per provider request (well under the API's input cap). */
const EMBED_BATCH_SIZE = 96;
/** Historical-context retrieval: candidates to pull before filtering to top-5. */
const HISTORY_CANDIDATES = 10;
const HISTORY_KEEP = 5;

/** URL/path-safe slug from a client name (mirrors apps/web `clientSlug`). */
function clientSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'client' : slug;
}

/** Path-safe slug from a meeting title (same rules as `clientSlug`; `untitled` fallback). */
function titleSlug(title: string | null): string {
  const slug = (title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'untitled' : slug;
}

/**
 * Group-folder segment for a meeting that belongs to a recurring series. Keyed off
 * the stable `series_id` (the clean Outlook GOID, migration 0011) — NOT the title —
 * so every occurrence groups together even if a title is edited, and two distinct
 * series that happen to share a title stay separate. Opaque + short; the folder's
 * human label stays the meeting title.
 */
function seriesGroupSegment(seriesId: string): string {
  return `series-${createHash('sha1').update(seriesId).digest('hex').slice(0, 12)}`;
}

/**
 * Deterministic MinIO keys + a two-level folder layout for a meeting's generated
 * docs + transcript. Docs file under a per-SERIES group folder — keyed by the
 * stable `seriesId` when the meeting recurs (so every occurrence nests together),
 * else by the title slug (one-offs) — and then a per-OCCURRENCE subfolder
 * (ET-stamped + meeting id, so it stays unique):
 *
 *   clients/<slug>/generated/<group>/<stamp>-<id8>/<type>.md
 *            └ client ┘        └series┘ └ occurrence ┘ └ file ┘
 *
 * Keyed off `dateTimeIso` (ET stamp) + `meetingId` — NOT wall-clock — so re-runs
 * of the SAME meeting resolve the SAME paths (idempotent), while two different
 * meetings for one client on one ET day get DISTINCT occurrence folders/keys (no
 * silent overwrite — the bug this fixes). Pure: unit-tested without a DB.
 */
export interface MeetingStorageKeys {
  /** ET timestamp `YYYYMMDD-HHMM` the occurrence is stamped with. */
  readonly stamp: string;
  /** R2 prefix of the series/title group folder (shared by all occurrences). */
  readonly groupFolderPath: string;
  /** Human label for the group folder (the meeting title). */
  readonly groupDisplayName: string;
  /** Unique R2 prefix of this occurrence's folder (under the group). */
  readonly occurrenceFolderPath: string;
  /** Human label for the occurrence folder, e.g. `2026-07-16 14:30` (ET). */
  readonly occurrenceDisplayName: string;
  /** Unique R2 key for this meeting's raw transcript. */
  readonly transcriptKey: string;
  /** R2 key for the timestamped transcript-segments JSON (meeting-page player). */
  readonly transcriptSegmentsKey: string;
  /** Unique R2 key for one generated doc file within this occurrence's folder. */
  objectKey(fileName: string): string;
}

export function buildMeetingStorageKeys(input: {
  readonly dateTimeIso: string;
  readonly meetingId: string;
  readonly title: string | null;
  readonly slug: string;
  /** Stable recurring-series key (meetings.series_id); null for one-offs. */
  readonly seriesId: string | null;
}): MeetingStorageKeys {
  const stamp = easternStamp(input.dateTimeIso);
  const id8 = input.meetingId.slice(0, 8);
  const groupSegment =
    input.seriesId !== null && input.seriesId !== ''
      ? seriesGroupSegment(input.seriesId)
      : titleSlug(input.title);
  const groupFolderPath = `clients/${input.slug}/generated/${groupSegment}`;
  const occurrenceFolderPath = `${groupFolderPath}/${stamp}-${id8}`;
  const trimmedTitle = input.title?.trim() ?? '';
  // `YYYYMMDD-HHMM` → readable `YYYY-MM-DD HH:MM` (ET) for the occurrence label.
  const occurrenceDisplayName = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`;
  return {
    stamp,
    groupFolderPath,
    groupDisplayName: trimmedTitle === '' ? 'Meeting' : trimmedTitle,
    occurrenceFolderPath,
    occurrenceDisplayName,
    transcriptKey: `clients/${input.slug}/transcripts/${stamp}-${id8}.txt`,
    // The transcript-segments JSON sits INSIDE the occurrence folder so canAccessKey
    // (the /api/files/raw gate) governs it by the client's folder visibility — no new
    // access surface. Video is NEVER stored (live-pulled from Recall on the page).
    transcriptSegmentsKey: `${occurrenceFolderPath}/transcript.json`,
    objectKey: (fileName: string) => `${occurrenceFolderPath}/${fileName}`,
  };
}

/** Patch a meeting row, throwing on error. */
async function patchMeeting(
  db: ServerClient,
  meetingId: string,
  patch: Database['public']['Tables']['meetings']['Update'],
): Promise<void> {
  const { error } = await db.from('meetings').update(patch).eq('id', meetingId);
  if (error !== null) throw new Error(`generate: patch meeting: ${error.message}`);
}

/** The GA `internal` org id (earliest-created), home for internal meetings; null if none. */
async function getInternalOrgId(db: ServerClient): Promise<string | null> {
  const { data, error } = await db
    .from('clients')
    .select('id')
    .eq('type', 'internal')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new Error(`generate: load GA internal org: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Capture a recorded meeting that has NO client yet, then DEFER doc generation
 * (operator directive: record every meeting, link a client afterward). The
 * transcript is fetched + stored durably and the meeting is marked
 * `transcript_received` so:
 *   - the watchdog leaves it alone (it only chases `transcript_received = false`);
 *   - the meeting page reads "ended / recorded";
 *   - generate-on-link can detect it (transcript captured, docs held) and re-run
 *     this pipeline the moment a client is linked.
 * Marked terminal (`cancelled`) with a benign status-null `pipeline_runs` row
 * carrying the plain-language "Recorded — link a client…" reason (never a red
 * failure). Never overwrites a completed meeting.
 */
async function captureWithoutClient(
  db: ServerClient,
  data: GenerationJobPayload,
  meetingId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  // Capture REGARDLESS of client so "link afterward" is useful: fetch the transcript
  // and store a durable, client-independent copy. A fetch failure throws → the outer
  // handler flags it needs_attention (a truly un-capturable recording IS a problem).
  const transcript = await resolveTranscript(data, log);
  await putObject(unlinkedTranscriptKey(meetingId), Buffer.from(transcript, 'utf8'), 'text/plain');

  const patched = await db
    .from('meetings')
    .update({ transcript_received: true, pipeline_status: 'cancelled' })
    .eq('id', meetingId)
    .neq('pipeline_status', 'complete');
  if (patched.error !== null) throw new Error(`generate: mark recorded-no-client: ${patched.error.message}`);

  const recorded = await db.from('pipeline_runs').insert({
    meeting_id: meetingId,
    source: 'recall',
    completed_at: new Date().toISOString(),
    documents_generated: 0,
    error_message: NO_CLIENT_SKIP_REASON,
  });
  if (recorded.error !== null) throw new Error(`generate: record no-client capture: ${recorded.error.message}`);
  log.info(
    { meetingId },
    'generate: no client yet — transcript captured, doc generation deferred until a client is linked',
  );
}

/** Plain-language reasons a recording is skipped as "no real meeting" (attendance gate). */
const NO_SHOW_REASONS: Record<NoShowReason, string> = {
  too_few_participants:
    'No real meeting — Gracie recorded but fewer than two people joined, so there is nothing to generate.',
  no_internal_participant:
    'Not recorded as a GA meeting — no Grace & Associates attendee joined this call, so there is nothing to generate.',
};

/**
 * Ghost-meeting attendance gate (side-effecting wrapper around
 * {@link decideAttendanceGate}). Decides whether a recording is a real meeting worth
 * generating notes for.
 *
 * Applies ONLY to a FRESH recording — one with a Recall bot whose transcript hasn't
 * been captured yet. A re-run / generate-on-link already proved the meeting happened
 * (`transcript_received`), so it is NEVER re-gated (Recall retention may have lapsed,
 * leaving no participant data — re-gating would wrongly suppress a real meeting).
 *
 * FAILS OPEN: no bot, no Recall key, or a Recall error → proceed. The guard only ever
 * suppresses a call it POSITIVELY measured as empty/one-sided — never a real meeting
 * on a transient hiccup.
 */
async function checkMeetingHappened(
  db: ServerClient,
  data: GenerationJobPayload,
  meeting: MeetingRow,
  log: FastifyBaseLogger,
): Promise<{ readonly kind: 'proceed' } | { readonly kind: 'no_show'; readonly reason: NoShowReason }> {
  if (typeof data.botJobId !== 'string' || data.botJobId === '') return { kind: 'proceed' };
  if (meeting.transcript_received) return { kind: 'proceed' };

  const apiKey = await getCredential('recall');
  if (apiKey === null || apiKey === '') return { kind: 'proceed' };

  let participants: RecallParticipant[];
  try {
    participants = await fetchRecallParticipants(data.botJobId, {
      apiKey,
      region: process.env.RECALL_REGION,
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'generate: participant fetch failed — proceeding (fail-open)',
    );
    return { kind: 'proceed' };
  }

  // Exclude Gracie's own bot so the ≥2 bar counts real people (Recall usually omits
  // the bot from meeting_participants, but a name match is a cheap, safe guard).
  // ponytail: a human genuinely named like the bot would be excluded — vanishingly
  // rare; upgrade to a Recall bot-id match if it ever bites.
  const botName = (await getBotConfig()).name.trim().toLowerCase();
  const humans = participants.filter((p) => (p.name ?? '').trim().toLowerCase() !== botName);

  // "Internal/GA" = an internal email domain, a known GA staff email, or a joined
  // display name matching a GA staff member (names are all Teams often exposes).
  const internalDomains = parseInternalDomains(await getSettingString(db, 'internal_email_domains'));
  const staff = await db.from('users').select('name, email');
  if (staff.error !== null) throw new Error(`generate: load staff for attendance gate: ${staff.error.message}`);
  const staffNames = new Set(
    (staff.data ?? []).map((u) => u.name.trim().toLowerCase()).filter((n) => n !== ''),
  );
  const staffEmails = new Set(
    (staff.data ?? []).map((u) => u.email.trim().toLowerCase()).filter((e) => e !== ''),
  );
  const isInternal = (p: AttendanceParticipant): boolean => {
    const email = (p.email ?? '').trim().toLowerCase();
    if (email !== '') {
      const dom = emailDomain(email);
      if (dom !== null && internalDomains.has(dom)) return true;
      if (staffEmails.has(email)) return true;
    }
    const name = (p.name ?? '').trim().toLowerCase();
    return name !== '' && staffNames.has(name);
  };

  const gate = decideAttendanceGate(humans, isInternal);
  if (gate.ok) return { kind: 'proceed' };

  // Data-loss safety on the fuzzy axis: NEVER drop a meeting we already KNOW is
  // GA-associated (flagged internal, or GA staff were invited) just because display
  // names couldn't confirm a joined GA person — Teams often hides participant emails
  // and shows nicknames, and losing a real meeting's notes is worse than the ghost we
  // guard against. The robust ≥2 "did it actually happen" bar has already held here.
  if (
    gate.reason === 'no_internal_participant' &&
    (meeting.is_internal || meeting.attendee_user_ids.length > 0)
  ) {
    log.info(
      { meetingId: meeting.id, humanParticipants: humans.length },
      'generate: attendance gate — no GA name match but meeting is GA-associated; proceeding',
    );
    return { kind: 'proceed' };
  }

  log.info(
    { meetingId: meeting.id, reason: gate.reason, humanParticipants: humans.length },
    'generate: attendance gate — no real meeting, skipping generation',
  );
  return { kind: 'no_show', reason: gate.reason };
}

/**
 * Mark a recording that FAILED the attendance gate as a benign "no real meeting"
 * skip — mirrors the no-client / duplicate-invite skips: the meeting goes terminal
 * (`cancelled`, never overwriting a completed one) and a status-null `pipeline_runs`
 * row carries the plain-language reason for the Pipeline view (an explanation, not a
 * red failure). No docs and no transcript are stored — there was no meeting.
 * `transcript_received` is left false so a manual re-run re-evaluates the gate rather
 * than being force-proceeded.
 */
async function markNoShow(
  db: ServerClient,
  meetingId: string,
  reason: NoShowReason,
  log: FastifyBaseLogger,
): Promise<void> {
  const cancelled = await db
    .from('meetings')
    .update({ pipeline_status: 'cancelled' })
    .eq('id', meetingId)
    .neq('pipeline_status', 'complete');
  if (cancelled.error !== null) throw new Error(`generate: mark no-show: ${cancelled.error.message}`);

  const recorded = await db.from('pipeline_runs').insert({
    meeting_id: meetingId,
    source: 'recall',
    completed_at: new Date().toISOString(),
    documents_generated: 0,
    error_message: NO_SHOW_REASONS[reason],
  });
  if (recorded.error !== null) throw new Error(`generate: record no-show: ${recorded.error.message}`);
  log.info({ meetingId, reason }, 'generate: recorded benign no-show skip (no real meeting)');
}

/**
 * Pick the org domain to file an unlinked meeting's docs under: the most-common
 * external-attendee domain that is NEITHER a GA-internal domain NOR a public
 * free-email provider (those can't identify a single org). Ties break
 * alphabetically so re-runs of the SAME meeting resolve the SAME domain
 * (idempotent). Returns null when no such domain exists → the caller falls back to
 * the #87 hold. Pure + exported for the unit test.
 */
export function pickUnlinkedDomain(
  externalAttendees: ReadonlyArray<{ readonly email?: string | null; readonly domain?: string | null }>,
  internalDomains: ReadonlySet<string>,
): string | null {
  const counts = new Map<string, number>();
  for (const attendee of externalAttendees) {
    const domain =
      typeof attendee.domain === 'string' && attendee.domain.trim() !== ''
        ? attendee.domain.trim().toLowerCase()
        : emailDomain(attendee.email);
    if (domain === null) continue;
    if (internalDomains.has(domain) || isFreeEmailDomain(domain)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  return ranked[0]?.[0] ?? null;
}

/**
 * Find (or create) the lightweight, DOMAIN-NAMED placeholder org that homes an
 * unlinked meeting's docs so they're visible (Documents browser + Clients →
 * "Unassigned"). Keyed by `type='unassigned'` + `name = domain`; deliberately NOT
 * registered in `client_domains`, so the domain stays "unknown" and the operator's
 * "create a real client from this domain" flow (+ the ambiguous-meetings prompt)
 * keep firing. Promoting a placeholder to a real client is just editing its type.
 *
 * ponytail: idempotent via select-first, no unique index (a partial index
 *   `where type='unassigned'` can't reference the enum value in the same migration
 *   that adds it — see 0018). Two generate jobs racing on a brand-new domain could
 *   create a duplicate placeholder — rare and cosmetic-only; add the partial index
 *   in a follow-up migration if it ever actually happens.
 */
async function findOrCreateDomainClient(db: ServerClient, domain: string): Promise<string> {
  const existing = await db
    .from('clients')
    .select('id')
    .eq('type', 'unassigned')
    .eq('name', domain)
    .order('created_at', { ascending: true })
    .limit(1);
  if (existing.error !== null) throw new Error(`generate: find domain org: ${existing.error.message}`);
  const found = existing.data?.[0]?.id;
  if (found !== undefined) return found;

  const created = await db
    .from('clients')
    .insert({
      name: domain,
      initials: deriveInitialsFromName(deriveOrgNameFromDomain(domain)),
      type: 'unassigned',
    })
    .select('id')
    .single();
  if (created.error !== null) throw new Error(`generate: create domain org: ${created.error.message}`);
  return created.data.id;
}

/**
 * For a client-less meeting, resolve the domain-named placeholder org to file its
 * docs under, or null when no org domain can be derived (no external attendees, or
 * only internal/free-email domains) → the caller falls back to the #87 hold.
 */
async function resolveUnlinkedDomainClient(
  db: ServerClient,
  meeting: MeetingRow,
  log: FastifyBaseLogger,
): Promise<string | null> {
  const attendees = Array.isArray(meeting.external_attendees)
    ? (meeting.external_attendees as ReadonlyArray<Partial<ExternalAttendee>>)
    : [];
  if (attendees.length === 0) return null;
  const internalDomains = parseInternalDomains(await getSettingString(db, 'internal_email_domains'));
  const domain = pickUnlinkedDomain(attendees, internalDomains);
  if (domain === null) return null;
  const clientId = await findOrCreateDomainClient(db, domain);
  log.info({ meetingId: meeting.id, domain, clientId }, 'generate: unlinked meeting filed under domain-named area');
  return clientId;
}

/** Read a global setting string (e.g. ga_company_description), or null if unset. */
async function getSettingString(db: ServerClient, key: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`generate: getSetting(${key}): ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

/** Read a global setting's raw jsonb value (any shape), or null if unset. */
async function getSettingJson(db: ServerClient, key: string): Promise<unknown> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`generate: getSetting(${key}): ${error.message}`);
  return data?.value ?? null;
}

/** Embed chunks through the pinned provider interface, in bounded batches. */
async function embedInBatches(
  provider: { embed(input: { input: readonly string[]; model?: string }): Promise<number[][]> },
  model: string,
  chunks: readonly string[],
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    vectors.push(...(await provider.embed({ input: batch, model })));
  }
  return vectors;
}

/** Format a pgvector literal from a numeric vector. */
function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

/** Read our durable unlinked-transcript copy, or null if absent/unreadable (best-effort). */
async function readUnlinkedTranscript(meetingId: string): Promise<string | null> {
  try {
    const text = (await getObjectBytes(unlinkedTranscriptKey(meetingId))).toString('utf8');
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

/**
 * Resolve the transcript: use `transcriptOverride` (test path) when present, else
 * fetch from Recall using the stored credential + bot_job_id (docs/06 §4). If Recall
 * has nothing (retention lapsed before a client was linked), fall back to our durable
 * unlinked copy so generate-on-link still completes the notes.
 */
async function resolveTranscript(
  data: GenerationJobPayload,
  log: FastifyBaseLogger,
): Promise<string> {
  if (typeof data.transcriptOverride === 'string' && data.transcriptOverride.trim() !== '') {
    log.info('generate: using transcriptOverride (test path)');
    return data.transcriptOverride;
  }
  if (data.botJobId === null || data.botJobId === '') {
    const stored = await readUnlinkedTranscript(data.meetingId);
    if (stored !== null) return stored;
    throw new Error('generate: no transcriptOverride and no botJobId to fetch from Recall');
  }
  const apiKey = await getCredential('recall');
  if (apiKey === null || apiKey === '') {
    throw new Error('generate: no Recall API key configured (Admin → API Settings).');
  }
  try {
    const fetched = await fetchRecallTranscript(data.botJobId, { apiKey, region: process.env.RECALL_REGION });
    if (fetched.trim() !== '') return fetched;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'generate: Recall transcript fetch failed — trying durable copy');
  }
  const stored = await readUnlinkedTranscript(data.meetingId);
  if (stored !== null) {
    log.info({ meetingId: data.meetingId }, 'generate: using durable unlinked transcript copy (Recall unavailable)');
    return stored;
  }
  throw new Error('generate: Recall returned no transcript and no durable copy is stored');
}

/** Embed the transcript chunks and (re)write `embeddings` rows; returns the vectors. */
async function embedTranscript(
  db: ServerClient,
  meetingId: string,
  clientId: string,
  chunks: readonly string[],
): Promise<number[][]> {
  const { provider, model } = await getEmbedder();
  const vectors = await embedInBatches(provider, model, chunks);
  if (vectors.length !== chunks.length) {
    throw new Error(`generate: embedding count ${vectors.length} != chunk count ${chunks.length}`);
  }

  // Idempotent re-runs: clear any prior transcript embeddings for this meeting.
  const cleared = await db
    .from('embeddings')
    .delete()
    .eq('source_type', 'transcript')
    .eq('source_id', meetingId);
  if (cleared.error !== null) {
    throw new Error(`generate: clear prior transcript embeddings: ${cleared.error.message}`);
  }

  const rows: EmbeddingInsert[] = chunks.map((content, index) => {
    const vector = vectors[index] ?? [];
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `generate: embedding dim ${vector.length} != ${EMBEDDING_DIMENSIONS} (chunk ${index})`,
      );
    }
    return {
      source_type: 'transcript',
      source_id: meetingId,
      client_id: clientId,
      chunk_index: index,
      content,
      embedding: toVectorLiteral(vector),
    };
  });
  const inserted = await db.from('embeddings').insert(rows);
  if (inserted.error !== null) {
    throw new Error(`generate: insert transcript embeddings: ${inserted.error.message}`);
  }
  return vectors;
}

/**
 * Build the layer-5 historical context: top-5 client-scoped similar chunks (via
 * `match_embeddings`, excluding this meeting's own transcript) + open tasks.
 */
async function buildHistoricalContext(
  db: ServerClient,
  clientId: string,
  meetingId: string,
  queryVector: readonly number[],
): Promise<string> {
  const sections: string[] = [];

  const { data: matches, error: matchError } = await db.rpc('match_embeddings', {
    match_client_id: clientId,
    match_count: HISTORY_CANDIDATES,
    query_embedding: toVectorLiteral(queryVector),
  });
  if (matchError !== null) throw new Error(`generate: match_embeddings: ${matchError.message}`);
  const recent = (matches ?? [])
    .filter((row) => row.source_id !== meetingId)
    .slice(0, HISTORY_KEEP)
    .map((row) => `- ${row.content.replace(/\s+/g, ' ').trim()}`);
  if (recent.length > 0) {
    sections.push(`Relevant context from earlier meetings/documents:\n${recent.join('\n')}`);
  }

  const { data: openTasks, error: taskError } = await db
    .from('tasks')
    .select('description, due_date, priority_flag')
    .eq('client_id', clientId)
    .neq('status', 'complete')
    .eq('archived', false)
    .limit(20);
  if (taskError !== null) throw new Error(`generate: open tasks: ${taskError.message}`);
  if (openTasks !== null && openTasks.length > 0) {
    const lines = openTasks.map((task) => {
      const due = task.due_date !== null ? ` (due ${task.due_date})` : '';
      const flag = task.priority_flag ? ' [priority]' : '';
      return `- ${task.description}${due}${flag}`;
    });
    sections.push(`Open action items for this client:\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

/** Layer-4 consultant context from the meeting's own metadata. */
function buildConsultantContext(meeting: MeetingRow): string {
  const parts: string[] = [];
  if (meeting.title !== null) parts.push(`Meeting: ${meeting.title}`);
  if (meeting.meeting_type !== null) parts.push(`Type: ${meeting.meeting_type}`);
  parts.push(`Date: ${easternDateString(new Date(meeting.date_time))}`);
  if (meeting.duration_minutes !== null) parts.push(`Duration: ${meeting.duration_minutes} min`);
  return parts.join('\n');
}

/** Store generated docs in MinIO and insert their `documents` rows; returns ids by type. */
async function persistDocuments(
  db: ServerClient,
  meeting: MeetingRow,
  clientId: string,
  slug: string,
  documents: readonly GeneratedDocument[],
  keys: MeetingStorageKeys,
  transcriptText: string,
): Promise<Map<GeneratedDocType, string>> {
  // Idempotent re-runs: clear prior meeting-generated docs for this meeting.
  const cleared = await db
    .from('documents')
    .delete()
    .eq('meeting_id', meeting.id)
    .eq('source_badge', 'meeting');
  if (cleared.error !== null) {
    throw new Error(`generate: clear prior documents: ${cleared.error.message}`);
  }

  // Drive-feel filing (docs/plan p2fix §2): file this run's docs under a
  // per-OCCURRENCE subfolder of a per-SERIES group folder (keyed by title slug),
  // inside the client's `Generated Docs` folder. The occurrence folder is unique
  // per meeting (ET-stamped + meeting id) so two same-day meetings never overwrite
  // each other, while every occurrence of a recurring meeting nests under one
  // group. Each ancestor must exist as its own row so the child nests correctly in
  // the browser tree (the tree builder keys children by path prefix).
  await findOrCreateFolder({
    clientId,
    path: `clients/${slug}/generated`,
    displayName: 'Generated Docs',
  });
  await findOrCreateFolder({
    clientId,
    path: keys.groupFolderPath,
    displayName: keys.groupDisplayName,
  });
  const occurrenceFolderId = await findOrCreateFolder({
    clientId,
    path: keys.occurrenceFolderPath,
    displayName: keys.occurrenceDisplayName,
  });

  const ids = new Map<GeneratedDocType, string>();
  for (const doc of documents) {
    const fileName = `${doc.type}.md`;
    const objectKey = keys.objectKey(fileName);
    await putObject(objectKey, Buffer.from(doc.content, 'utf8'), 'text/markdown');

    const insert: DocumentInsert = {
      client_id: clientId,
      meeting_id: meeting.id,
      folder_id: occurrenceFolderId,
      document_type: DOC_TYPE_TO_ENUM[doc.type],
      source_badge: 'meeting',
      r2_key: objectKey,
      file_name: fileName,
      file_size: Buffer.byteLength(doc.content, 'utf8'),
      requires_review: doc.spec.requiresReview,
      status: doc.spec.requiresReview ? 'needs_review' : 'ready',
    };
    const { data, error } = await db.from('documents').insert(insert).select('id').single();
    if (error !== null) throw new Error(`generate: insert document ${doc.type}: ${error.message}`);
    ids.set(doc.type, data.id);
  }

  // The raw meeting transcript, filed as a VISIBLE, downloadable document alongside
  // the generated docs — same occurrence folder, so canAccessKey governs it exactly
  // like the rest. This is our durable, going-forward transcript copy (the player's
  // timestamped segments are stored separately as transcript.json backing data).
  // `other` reuses an existing document_type value (no enum migration); the readable
  // name is `transcript.md`, the source badge is `meeting` (cleared+recreated on
  // re-runs by the delete above).
  const transcriptFileName = 'transcript.md';
  const transcriptKey = keys.objectKey(transcriptFileName);
  await putObject(transcriptKey, Buffer.from(transcriptText, 'utf8'), 'text/markdown');
  const transcriptInsert: DocumentInsert = {
    client_id: clientId,
    meeting_id: meeting.id,
    folder_id: occurrenceFolderId,
    document_type: 'other',
    source_badge: 'meeting',
    r2_key: transcriptKey,
    file_name: transcriptFileName,
    file_size: Buffer.byteLength(transcriptText, 'utf8'),
    requires_review: false,
    status: 'ready',
  };
  const transcriptDoc = await db.from('documents').insert(transcriptInsert);
  if (transcriptDoc.error !== null) {
    throw new Error(`generate: insert transcript document: ${transcriptDoc.error.message}`);
  }
  return ids;
}

interface TaskLifecycleResult {
  readonly inserted: number;
  readonly escalated: number;
  readonly reactivated: number;
  readonly evicted: number;
  readonly hasOpenItems: boolean;
}

/**
 * Apply the extracted checklist to the client's task list under the lifecycle rules
 * (tasks lifecycle core):
 *   - DEDUP against the client's still-live tasks (active OR archived; completed tasks
 *     are excluded so a re-mention of finished work is new work). A repeat is NOT
 *     duplicated — an active match is escalated to HIGH, an archived match is
 *     reactivated as HIGH. This is what stops the duplicate pile.
 *   - Owner is set only when a person is clearly named (`resolveTaskOwner`); otherwise
 *     the task lives under the client, unassigned.
 *   - After applying, the active list is capped per client — the stalest STANDARD tasks
 *     are archived (high tasks never auto-evict).
 * Idempotent per meeting: this meeting's own prior tasks are cleared first, so a re-run
 * re-derives from the transcript without self-duplicating.
 */
async function applyExtractedTasks(
  db: ServerClient,
  clientId: string,
  meetingId: string,
  extracted: readonly ExtractedTask[],
  checklistDocId: string | null,
): Promise<TaskLifecycleResult> {
  // Idempotent re-runs: drop this meeting's own prior tasks before re-deriving.
  const cleared = await db.from('tasks').delete().eq('source_meeting_id', meetingId);
  if (cleared.error !== null) throw new Error(`generate: clear prior tasks: ${cleared.error.message}`);

  // Dedup candidates: this client's still-live tasks — active OR archived, but never
  // completed (a re-mention of done work should create fresh work).
  const existing = await db
    .from('tasks')
    .select('id, description, archived, status')
    .eq('client_id', clientId);
  if (existing.error !== null) throw new Error(`generate: load existing tasks: ${existing.error.message}`);
  const candidates = (existing.data ?? [])
    .filter((task) => task.archived || task.status !== 'complete')
    .map((task) => ({ id: task.id, description: task.description, archived: task.archived }));

  const usersRes = await db.from('users').select('id, name, email');
  if (usersRes.error !== null) throw new Error(`generate: load users: ${usersRes.error.message}`);
  const users = usersRes.data ?? [];

  const nowIso = new Date().toISOString();
  let inserted = 0;
  let escalated = 0;
  let reactivated = 0;

  for (const task of extracted) {
    const match = findDuplicateTask(task.description, candidates);
    const decision = decideTaskUpsert(task, match);
    if (decision.kind === 'insert') {
      const row: TaskInsert = {
        client_id: clientId,
        source_meeting_id: meetingId,
        source_document_id: checklistDocId,
        description: task.description,
        owner_user_id: resolveTaskOwner(task.ownerHint, users),
        due_date: parseDueDate(task.dueHint),
        priority_flag: decision.high,
        status: 'open',
      };
      const ins = await db.from('tasks').insert(row).select('id').single();
      if (ins.error !== null) throw new Error(`generate: insert task: ${ins.error.message}`);
      // Add to candidates so a near-dup later in THIS batch escalates rather than duplicating.
      candidates.push({ id: ins.data.id, description: task.description, archived: false });
      inserted += 1;
    } else if (decision.kind === 'escalate') {
      const upd = await db
        .from('tasks')
        .update({ priority_flag: true, updated_at: nowIso })
        .eq('id', decision.id);
      if (upd.error !== null) throw new Error(`generate: escalate task: ${upd.error.message}`);
      escalated += 1;
    } else {
      const upd = await db
        .from('tasks')
        .update({ archived: false, status: 'open', priority_flag: true, updated_at: nowIso })
        .eq('id', decision.id);
      if (upd.error !== null) throw new Error(`generate: reactivate task: ${upd.error.message}`);
      // Now active — a later dup in this batch should escalate it, not reactivate again.
      const entry = candidates.find((candidate) => candidate.id === decision.id);
      if (entry !== undefined) entry.archived = false;
      reactivated += 1;
    }
  }

  // Cap the active list per client: archive the stalest STANDARD tasks (never high).
  const activeRes = await db
    .from('tasks')
    .select('id, priority_flag, updated_at, created_at')
    .eq('client_id', clientId)
    .eq('archived', false)
    .neq('status', 'complete');
  if (activeRes.error !== null) throw new Error(`generate: load active tasks: ${activeRes.error.message}`);
  const active = (activeRes.data ?? []).map((task) => ({
    id: task.id,
    priorityFlag: task.priority_flag,
    updatedAt: task.updated_at,
    createdAt: task.created_at,
  }));
  const evictIds = decideCapEvictions(active);
  if (evictIds.length > 0) {
    const archived = await db
      .from('tasks')
      .update({ archived: true, updated_at: nowIso })
      .in('id', evictIds);
    if (archived.error !== null) throw new Error(`generate: cap-evict tasks: ${archived.error.message}`);
  }

  return {
    inserted,
    escalated,
    reactivated,
    evicted: evictIds.length,
    hasOpenItems: inserted + escalated + reactivated > 0,
  };
}

/** Parse a due hint to YYYY-MM-DD only when it carries an explicit calendar date. */
function parseDueDate(hint: string | null): string | null {
  if (hint === null) return null;
  const trimmed = hint.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /\b\d{4}\b/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return null; // relative/ambiguous ("next Friday") → left for manual assignment
}

/** Short master-record digest from a generated doc (strip [VERIFY] wrappers, clamp). */
export function buildDigest(content: string): string {
  const cleaned = content
    .replace(/\[VERIFY:\s*([^\]]*)\]/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= 600 ? cleaned : `${cleaned.slice(0, 597)}…`;
}

/**
 * Decide the `meeting_media` row for the click-to-seek player. VIDEO IS NEVER STORED
 * (`video_key` stays null — the meeting page live-pulls it straight from Recall on
 * view), so this only records the timestamped-segments key, and only when segments
 * were actually stored (empty transcript → null → player degrades to "no transcript").
 * PURE and exported for unit tests — the side-effecting {@link storeMeetingMedia}
 * writes the segments JSON, then records exactly this row.
 */
export function decideMeetingMediaRow(input: {
  readonly meetingId: string;
  readonly transcriptSegmentsKey: string;
  readonly segmentCount: number;
  readonly durationS: number | null;
  readonly fetchedAt: string;
}): MeetingMediaInsert {
  return {
    meeting_id: input.meetingId,
    // Video is live-pulled from Recall on the meeting page, never persisted here.
    video_key: null,
    transcript_key: input.segmentCount > 0 ? input.transcriptSegmentsKey : null,
    video_duration_s: input.durationS,
    fetched_at: input.fetchedAt,
  };
}

/**
 * Best-effort: fetch the timestamped transcript segments from Recall and store them
 * as JSON for the meeting-page click-to-seek player, then UPSERT one `meeting_media`
 * row keyed by meeting_id (idempotent re-runs). The readable, durable transcript
 * DOCUMENT is filed separately by {@link persistDocuments}; VIDEO is never stored
 * (the page live-pulls it from Recall). The caller wraps this so a media hiccup NEVER
 * fails generation — the docs already committed.
 */
async function storeMeetingMedia(
  db: ServerClient,
  log: FastifyBaseLogger,
  meetingId: string,
  botJobId: string,
  keys: MeetingStorageKeys,
): Promise<void> {
  const apiKey = await getCredential('recall');
  if (apiKey === null || apiKey === '') {
    log.info({ meetingId }, 'generate: no Recall key — skipping meeting media');
    return;
  }
  const media: RecallMedia = await fetchRecallMedia(botJobId, {
    apiKey,
    region: process.env.RECALL_REGION,
  });

  // Only the seek-segments are persisted here — the video URL Recall returned is
  // deliberately ignored (never stored; the page streams it live from Recall).
  if (media.segments.length > 0) {
    await putObject(
      keys.transcriptSegmentsKey,
      Buffer.from(JSON.stringify(media.segments), 'utf8'),
      'application/json',
    );
  }

  const row = decideMeetingMediaRow({
    meetingId,
    transcriptSegmentsKey: keys.transcriptSegmentsKey,
    segmentCount: media.segments.length,
    durationS: media.durationS,
    fetchedAt: new Date().toISOString(),
  });
  const { error } = await db.from('meeting_media').upsert(row, { onConflict: 'meeting_id' });
  if (error !== null) throw new Error(`generate: upsert meeting_media: ${error.message}`);
  log.info(
    { meetingId, segments: media.segments.length },
    'generate: stored meeting transcript segments (video is live-pulled, not stored)',
  );

  // Screen-share stills: extract slide/screen-change frames from the (never-stored)
  // mixed video and keep them FOREVER, so they outlive the video's retention. Its own
  // try/catch: the segments above are already committed, so a stills failure (ffmpeg
  // missing, a bad stream) must not undo them.
  if (media.videoUrl !== null) {
    try {
      await storeScreenShareStills(db, log, meetingId, keys, media.videoUrl);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'generate: stills store failed (best-effort)');
    }
  }
}

/**
 * Extract screen-share stills from the mixed video and persist them under the meeting's
 * OCCURRENCE folder (so `canAccessKey` governs them like every other object) plus a
 * `meeting_stills` row each. Kept indefinitely — the permanent visual record after the
 * video expires. Idempotent + cheap on re-runs: if this meeting already has stills we
 * SKIP the expensive ffmpeg pass entirely. Best-effort (the caller swallows failures).
 */
async function storeScreenShareStills(
  db: ServerClient,
  log: FastifyBaseLogger,
  meetingId: string,
  keys: MeetingStorageKeys,
  videoUrl: string,
): Promise<void> {
  const existing = await db.from('meeting_stills').select('id').eq('meeting_id', meetingId).limit(1);
  if (existing.error !== null) throw new Error(`generate: check meeting_stills: ${existing.error.message}`);
  if ((existing.data ?? []).length > 0) {
    log.info({ meetingId }, 'generate: stills already extracted — skipping');
    return;
  }

  const stills = await extractScreenShareStills(videoUrl, { log });
  if (stills.length === 0) {
    log.info({ meetingId }, 'generate: no screen-share stills detected');
    return;
  }

  const rows: MeetingStillInsert[] = [];
  for (let i = 0; i < stills.length; i += 1) {
    const still = stills[i];
    if (still === undefined) continue;
    const objectKey = `${keys.occurrenceFolderPath}/stills/${String(i).padStart(3, '0')}-${still.tsSeconds}.jpg`;
    await putObject(objectKey, still.jpeg, 'image/jpeg');
    rows.push({ meeting_id: meetingId, ts_seconds: still.tsSeconds, object_key: objectKey });
  }
  const inserted = await db.from('meeting_stills').insert(rows);
  if (inserted.error !== null) throw new Error(`generate: insert meeting_stills: ${inserted.error.message}`);
  log.info({ meetingId, stills: rows.length }, 'generate: stored screen-share stills');
}

/** Build the generation processor, logging through the worker's Fastify logger. */
export function createGenerateProcessor(
  logger: FastifyBaseLogger,
  /**
   * Optional best-effort hook to refresh the client's relationship health after a
   * meeting completes (P2.1). A completed meeting changes `last_meeting_at` and adds
   * tasks + a master-record entry — all health inputs — so we enqueue a single-client
   * recompute. Failure never fails the pipeline; the nightly sweep is the backstop.
   */
  enqueueHealthForClient?: (clientId: string) => Promise<void>,
): Processor<GenerationJobPayload, GenerateResult> {
  return async (job: Job<GenerationJobPayload>): Promise<GenerateResult> => {
    const db = getServerClient();
    const { meetingId } = job.data;
    const log = logger.child({ jobId: job.id, meetingId });
    const startedAt = new Date();
    const attempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attempts;

    try {
      // 1. Load meeting + client.
      const { data: meeting, error: meetingError } = await db
        .from('meetings')
        .select('*')
        .eq('id', meetingId)
        .maybeSingle();
      if (meetingError !== null) throw new Error(`generate: load meeting: ${meetingError.message}`);
      if (meeting === null) throw new Error(`generate: meeting ${meetingId} not found`);

      // Ghost-meeting attendance gate: a stale/duplicate calendar entry can send a bot
      // into a call that never really happens. If the recording is not a real meeting
      // (fewer than two people joined, or no GA attendee), skip generation gracefully
      // as a benign "no real meeting" outcome — no red failure, no docs. Independent of
      // whether a client is linked: a real-but-unlinked meeting still proceeds.
      const attendance = await checkMeetingHappened(db, job.data, meeting, log);
      if (attendance.kind === 'no_show') {
        await markNoShow(db, meetingId, attendance.reason, log);
        return { meetingId, documents: 0, tasks: 0, status: 'skipped' };
      }

      // No-client handling (root cause #2): self-heal internal meetings → the GA org,
      // and skip genuinely client-less meetings gracefully instead of hard-failing.
      const resolution = resolveMeetingClientId(
        meeting,
        meeting.client_id === null ? await getInternalOrgId(db) : null,
      );
      // No real client: file the docs under a DOMAIN-NAMED placeholder org so they're
      // visible/findable (Documents browser + Clients → "Unassigned") instead of held
      // invisibly. If no org domain can be derived, fall back to the #87 hold.
      let clientId: string;
      if (resolution.kind === 'skip') {
        const domainClientId = await resolveUnlinkedDomainClient(db, meeting, log);
        if (domainClientId === null) {
          await captureWithoutClient(db, job.data, meetingId, log);
          return { meetingId, documents: 0, tasks: 0, status: 'skipped' };
        }
        clientId = domainClientId;
        await patchMeeting(db, meetingId, { client_id: clientId });
      } else {
        clientId = resolution.clientId;
        if (resolution.kind === 'assign') {
          await patchMeeting(db, meetingId, { client_id: clientId });
          log.info({ meetingId, clientId }, 'generate: internal meeting had no client — homed to the GA org');
        }
      }

      const { data: client, error: clientError } = await db
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();
      if (clientError !== null) throw new Error(`generate: load client: ${clientError.message}`);
      if (client === null) throw new Error(`generate: client ${clientId} not found`);
      const typedClient: ClientRow = client;
      const slug = clientSlug(typedClient.name);

      // Deterministic, per-meeting storage keys (ET-stamped + meeting id) so two
      // same-client/same-day meetings never overwrite each other, while a re-run of
      // this meeting resolves the SAME keys (idempotent).
      const keys = buildMeetingStorageKeys({
        dateTimeIso: meeting.date_time,
        meetingId: meeting.id,
        title: meeting.title,
        slug,
        seriesId: meeting.series_id,
      });
      const meetingDate = easternDateString(new Date(meeting.date_time));

      await patchMeeting(db, meetingId, {
        pipeline_status: 'processing',
        pipeline_started_at: meeting.pipeline_started_at ?? startedAt.toISOString(),
      });

      // 2. Transcript → store raw in MinIO → mark received.
      const transcript = await resolveTranscript(job.data, log);
      await putObject(keys.transcriptKey, Buffer.from(transcript, 'utf8'), 'text/plain');
      await patchMeeting(db, meetingId, { transcript_received: true });

      // 3. Embed transcript → embeddings (source_type='transcript').
      const chunks = chunkText(transcript);
      if (chunks.length === 0) throw new Error('generate: transcript produced no chunks');
      const vectors = await embedTranscript(db, meetingId, clientId, chunks);

      // 4. Historical context (layer 5) keyed off the first transcript chunk.
      const historicalContext = await buildHistoricalContext(
        db,
        clientId,
        meetingId,
        vectors[0] ?? [],
      );

      // 5. Generate the 6 docs sequentially via the reusable core (D7).
      const { provider, model } = await getActiveProvider();
      const gaCompanyDescription =
        (await getSettingString(db, 'ga_company_description')) ??
        'Grace & Associates — a federal healthcare consulting firm.';
      // Editable generation prompts (PE): admin overrides from Settings, else the
      // shared defaults. Tolerates the key being absent/malformed → all defaults.
      const prompts = resolveGenerationPrompts(
        await getSettingJson(db, 'generation_prompt_overrides'),
      );
      const { documents, tasks } = await generateDocuments({
        provider,
        model,
        logger: log,
        prompts,
        context: {
          gaCompanyDescription,
          clientDescription: typedClient.description ?? '',
          consultantContext: buildConsultantContext(meeting),
          historicalContext,
          sourceContent: transcript,
        },
      });

      // 6. Store docs + insert `documents` rows (incl. the visible transcript document).
      const docIds = await persistDocuments(db, meeting, clientId, slug, documents, keys, transcript);

      // 7. Tasks: apply the parsed checklist under the lifecycle rules (dedup + escalate
      //    + owner-on-name + per-client cap). `tasks === null` means the checklist JSON
      //    never parsed (partial run) → clear this meeting's prior tasks, add nothing.
      const checklistDocId = docIds.get('task_checklist') ?? null;
      const taskOutcome = await applyExtractedTasks(db, clientId, meetingId, tasks ?? [], checklistDocId);
      const tasksInserted = taskOutcome.inserted;
      await patchMeeting(db, meetingId, { has_open_items: taskOutcome.hasOpenItems });
      if (taskOutcome.escalated + taskOutcome.reactivated + taskOutcome.evicted > 0) {
        log.info(
          {
            inserted: taskOutcome.inserted,
            escalated: taskOutcome.escalated,
            reactivated: taskOutcome.reactivated,
            evicted: taskOutcome.evicted,
          },
          'generate: task lifecycle applied (dedup/escalate/cap)',
        );
      }

      // 8. Master record digest (from the analysis, else the first doc).
      const digestSource =
        documents.find((d) => d.type === 'post_meeting_analysis') ?? documents[0];
      const { error: masterError } = await db.from('master_record_entries').insert({
        client_id: clientId,
        meeting_id: meetingId,
        summary: digestSource !== undefined ? buildDigest(digestSource.content) : '(no content)',
      });
      if (masterError !== null) {
        throw new Error(`generate: insert master record: ${masterError.message}`);
      }

      // 9. pipeline_runs — success (or partial when the checklist JSON never parsed).
      const completedAt = new Date();
      const runStatus: Database['public']['Enums']['pipeline_run_status'] =
        tasks === null ? 'partial' : 'success';
      const { error: runError } = await db.from('pipeline_runs').insert({
        meeting_id: meetingId,
        source: 'recall',
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_seconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
        documents_generated: documents.length,
        status: runStatus,
      });
      if (runError !== null) throw new Error(`generate: insert pipeline_run: ${runError.message}`);

      // 10. Mark complete + notify attendees in-app (docs/06 §4).
      await patchMeeting(db, meetingId, {
        pipeline_status: 'complete',
        pipeline_completed_at: completedAt.toISOString(),
      });
      await notifyAttendees(db, meeting, typedClient, meetingDate);

      // Refresh relationship health now the meeting is complete (P2.1) — best-effort.
      if (enqueueHealthForClient !== undefined) {
        try {
          await enqueueHealthForClient(clientId);
        } catch (healthError) {
          log.warn({ err: healthError }, 'generate: health recompute enqueue failed');
        }
      }

      // 11. Timestamped transcript segments for the meeting-page click-to-seek player
      // (video is live-pulled from Recall on the page, never stored) — BEST-EFFORT:
      // the docs (incl. the readable transcript) are already committed, so a segments
      // failure must never undo the run. Skipped for the transcript-override (test)
      // path, which has no Recall bot to pull segments from.
      const botJobId = job.data.botJobId;
      if (typeof botJobId === 'string' && botJobId !== '') {
        try {
          await storeMeetingMedia(db, log, meetingId, botJobId, keys);
        } catch (mediaError) {
          log.warn({ err: mediaError }, 'generate: meeting media store failed (best-effort)');
        }
      }

      log.info(
        { documents: documents.length, tasks: tasksInserted, status: runStatus },
        'generate complete',
      );
      return {
        meetingId,
        documents: documents.length,
        tasks: tasksInserted,
        status: runStatus,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: message, attempt: job.attemptsMade + 1, isLastAttempt }, 'generate failed');
      if (isLastAttempt) {
        await markRunFailed(db, meetingId, startedAt, message, log).catch((e: unknown) =>
          log.error({ err: e }, 'generate: failed to record failure state'),
        );
      }
      throw error instanceof Error ? error : new Error(message);
    }
  };
}

/** Insert a `documents_ready` notification per attendee (docs/06 §4). */
async function notifyAttendees(
  db: ServerClient,
  meeting: MeetingRow,
  client: ClientRow,
  meetingDate: string,
): Promise<void> {
  if (meeting.attendee_user_ids.length === 0) return;
  const rows: NotificationInsert[] = meeting.attendee_user_ids.map((userId) => ({
    user_id: userId,
    type: 'documents_ready',
    title: `Documents ready for ${client.name} — ${meetingDate}`,
    link: `/clients/${client.id}`,
  }));
  const { error } = await db.from('notifications').insert(rows);
  if (error !== null) throw new Error(`generate: insert notifications: ${error.message}`);
}

/**
 * On the final failed attempt: flag the meeting, write a failed `pipeline_runs`
 * row, raise a `pipeline_failed` in-app notification to the meeting lead (else
 * attendees), and email the Admins (allowlist-gated, best-effort) — P7 §5.
 */
async function markRunFailed(
  db: ServerClient,
  meetingId: string,
  startedAt: Date,
  message: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const status: PipelineStatus = 'needs_attention';
  await db.from('meetings').update({ pipeline_status: status }).eq('id', meetingId);
  const completedAt = new Date();
  await db.from('pipeline_runs').insert({
    meeting_id: meetingId,
    source: 'recall',
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_seconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    documents_generated: 0,
    status: 'failed',
    error_message: message.slice(0, 1000),
  });

  // Alert: in-app to the relevant user(s) + email to admins.
  const { data: meeting } = await db
    .from('meetings')
    .select('title, meeting_lead_user_id, attendee_user_ids, client_id')
    .eq('id', meetingId)
    .maybeSingle();
  const label = meeting?.title ?? 'a meeting';
  const link = meeting?.client_id != null ? `/clients/${meeting.client_id}` : '/pipeline';
  const recipients =
    meeting?.meeting_lead_user_id != null
      ? [meeting.meeting_lead_user_id]
      : meeting?.attendee_user_ids ?? [];
  if (recipients.length > 0) {
    const rows: NotificationInsert[] = recipients.map((userId) => ({
      user_id: userId,
      type: 'pipeline_failed',
      title: `Generation failed for ${label}`,
      body: 'The meeting pipeline failed after retries. Review or re-run it from the Pipeline.',
      link,
    }));
    const { error } = await db.from('notifications').insert(rows);
    if (error !== null) log.warn({ err: error.message }, 'generate: could not insert pipeline_failed notification');
  }
  await emailAdminsForAlert(
    { type: 'pipeline_failed', title: `Generation failed for ${label}`, body: message.slice(0, 300), link },
    { logger: log, db },
  );
}
