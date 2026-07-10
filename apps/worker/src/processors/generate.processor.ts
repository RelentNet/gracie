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
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import {
  findOrCreateFolder,
  getActiveProvider,
  getCredential,
  getEmbedder,
  getServerClient,
} from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import {
  EMBEDDING_DIMENSIONS,
  type GeneratedDocType,
  type GenerationJobPayload,
} from '@gracie/shared';
import { putObject } from '@gracie/shared/storage';

import { chunkText } from '../lib/chunk.js';
import { emailAdminsForAlert } from '../lib/email.js';
import { generateDocuments, type GeneratedDocument } from '../lib/generate.js';
import { fetchRecallTranscript } from '../lib/recall.js';

type DocumentTypeEnum = Database['public']['Enums']['document_type'];
type PipelineStatus = Database['public']['Enums']['pipeline_status'];
type MeetingRow = Database['public']['Tables']['meetings']['Row'];
type ClientRow = Database['public']['Tables']['clients']['Row'];
type EmbeddingInsert = Database['public']['Tables']['embeddings']['Insert'];
type DocumentInsert = Database['public']['Tables']['documents']['Insert'];
type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

/** Outcome of a generation run (returned to BullMQ; visible in Bull Board). */
export interface GenerateResult {
  readonly meetingId: string;
  readonly documents: number;
  readonly tasks: number;
  readonly status: 'success' | 'partial';
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

/** Patch a meeting row, throwing on error. */
async function patchMeeting(
  db: ServerClient,
  meetingId: string,
  patch: Database['public']['Tables']['meetings']['Update'],
): Promise<void> {
  const { error } = await db.from('meetings').update(patch).eq('id', meetingId);
  if (error !== null) throw new Error(`generate: patch meeting: ${error.message}`);
}

/** Read a global setting string (e.g. ga_company_description), or null if unset. */
async function getSettingString(db: ServerClient, key: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`generate: getSetting(${key}): ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
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

/**
 * Resolve the transcript: use `transcriptOverride` (test path) when present, else
 * fetch from Recall using the stored credential + bot_job_id (docs/06 §4).
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
    throw new Error('generate: no transcriptOverride and no botJobId to fetch from Recall');
  }
  const apiKey = await getCredential('recall');
  if (apiKey === null || apiKey === '') {
    throw new Error('generate: no Recall API key configured (Admin → API Settings).');
  }
  return fetchRecallTranscript(data.botJobId, {
    apiKey,
    region: process.env.RECALL_REGION,
  });
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
  parts.push(`Date: ${meeting.date_time.slice(0, 10)}`);
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
): Promise<Map<GeneratedDocType, string>> {
  const meetingDate = meeting.date_time.slice(0, 10);

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
  // per-run date subfolder of the client's `Generated Docs` folder. Ensure the
  // parent first so the subfolder nests correctly in the browser tree.
  await findOrCreateFolder({
    clientId,
    path: `clients/${slug}/generated`,
    displayName: 'Generated Docs',
  });
  const dateFolderId = await findOrCreateFolder({
    clientId,
    path: `clients/${slug}/generated/${meetingDate}`,
    displayName: meetingDate,
  });

  const ids = new Map<GeneratedDocType, string>();
  for (const doc of documents) {
    const fileName = `${doc.type}.md`;
    const objectKey = `clients/${slug}/generated/${meetingDate}/${fileName}`;
    await putObject(objectKey, Buffer.from(doc.content, 'utf8'), 'text/markdown');

    const insert: DocumentInsert = {
      client_id: clientId,
      meeting_id: meeting.id,
      folder_id: dateFolderId,
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
  return ids;
}

/** Resolve an owner hint to a user id by matching name/email (else null). */
function resolveOwner(
  hint: string | null,
  users: ReadonlyArray<{ id: string; name: string; email: string }>,
): string | null {
  if (hint === null) return null;
  const needle = hint.trim().toLowerCase();
  if (needle === '') return null;
  for (const user of users) {
    const name = user.name.toLowerCase();
    const email = user.email.toLowerCase();
    if (needle === name || needle === email || email.split('@')[0] === needle) return user.id;
  }
  // Looser: hint is a first name / substring of a full name.
  for (const user of users) {
    const name = user.name.toLowerCase();
    if (name.split(/\s+/).includes(needle) || name.includes(needle) || needle.includes(name)) {
      return user.id;
    }
  }
  return null;
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
function buildDigest(content: string): string {
  const cleaned = content
    .replace(/\[VERIFY:\s*([^\]]*)\]/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= 600 ? cleaned : `${cleaned.slice(0, 597)}…`;
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
      if (meeting.client_id === null) throw new Error(`generate: meeting ${meetingId} has no client`);
      const clientId = meeting.client_id;

      const { data: client, error: clientError } = await db
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();
      if (clientError !== null) throw new Error(`generate: load client: ${clientError.message}`);
      if (client === null) throw new Error(`generate: client ${clientId} not found`);
      const typedClient: ClientRow = client;
      const slug = clientSlug(typedClient.name);

      await patchMeeting(db, meetingId, {
        pipeline_status: 'processing',
        pipeline_started_at: meeting.pipeline_started_at ?? startedAt.toISOString(),
      });

      // 2. Transcript → store raw in MinIO → mark received.
      const transcript = await resolveTranscript(job.data, log);
      const meetingDate = meeting.date_time.slice(0, 10);
      const transcriptKey = `clients/${slug}/transcripts/${meetingDate}.txt`;
      await putObject(transcriptKey, Buffer.from(transcript, 'utf8'), 'text/plain');
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
      const { documents, tasks } = await generateDocuments({
        provider,
        model,
        logger: log,
        context: {
          gaCompanyDescription,
          clientDescription: typedClient.description ?? '',
          consultantContext: buildConsultantContext(meeting),
          historicalContext,
          sourceContent: transcript,
        },
      });

      // 6. Store docs + insert `documents` rows.
      const docIds = await persistDocuments(db, meeting, clientId, slug, documents);

      // 7. Tasks: insert parsed checklist (idempotent: clear prior for this meeting first).
      const clearedTasks = await db.from('tasks').delete().eq('source_meeting_id', meetingId);
      if (clearedTasks.error !== null) {
        throw new Error(`generate: clear prior tasks: ${clearedTasks.error.message}`);
      }
      let tasksInserted = 0;
      if (tasks !== null && tasks.length > 0) {
        const { data: users, error: usersError } = await db
          .from('users')
          .select('id, name, email');
        if (usersError !== null) throw new Error(`generate: load users: ${usersError.message}`);
        const checklistDocId = docIds.get('task_checklist') ?? null;
        const taskRows: TaskInsert[] = tasks.map((task) => ({
          client_id: clientId,
          source_meeting_id: meetingId,
          source_document_id: checklistDocId,
          description: task.description,
          owner_user_id: resolveOwner(task.ownerHint, users ?? []),
          due_date: parseDueDate(task.dueHint),
          priority_flag: task.priority,
          status: 'open',
        }));
        const insertedTasks = await db.from('tasks').insert(taskRows);
        if (insertedTasks.error !== null) {
          throw new Error(`generate: insert tasks: ${insertedTasks.error.message}`);
        }
        tasksInserted = taskRows.length;
      }
      await patchMeeting(db, meetingId, { has_open_items: tasksInserted > 0 });

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
