/**
 * Server-side data access for the meeting-occurrence page (`/meetings/[id]`,
 * Phase A). Everything here is keyed by a single meeting id — the per-occurrence
 * data we already store (docs/plan meeting-occurrence-page §1).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement is
 * the page/API layer's job (docs/02 §D14). Server-only — never import into a client
 * component. Prior-meeting history, client lookup and folder visibility reuse the
 * existing data layer + shared resolver rather than re-querying by hand.
 */
import 'server-only';

import { getCredential, getServerClient } from '@gracie/db';
import type { Document, MasterRecordEntry, Meeting, Role, Task, TranscriptSegment } from '@gracie/shared';
import { downloadRecallTranscript, fetchRecallRecordingUrls } from '@gracie/shared/recall';
import { getObjectBytes, putObject } from '@gracie/shared/storage';

import { decideTranscriptSource } from '../meeting-occurrence.js';
import { mapMasterRecordEntry } from '../mappers/client-extras.js';
import { mapDocument } from '../mappers/document.js';
import { mapMeeting } from '../mappers/meeting.js';
import { mapTask } from '../mappers/task.js';
import { canAccessKey } from './files.js';

/** Fetch a single meeting by id, or null if not found. */
export async function getMeetingById(id: string): Promise<Meeting | null> {
  const db = getServerClient();
  const { data, error } = await db.from('meetings').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getMeetingById: ${error.message}`);
  return data === null ? null : mapMeeting(data);
}

/**
 * All LIVE documents generated for THIS occurrence (`documents.meeting_id`),
 * oldest first. Recycle-bin rows are excluded. The caller MUST still run these
 * through the folder/document visibility filters before showing them to a
 * non-admin (the Transcripts folder is restricted).
 */
export async function getMeetingDocuments(meetingId: string): Promise<Document[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error !== null) throw new Error(`getMeetingDocuments: ${error.message}`);
  return (data ?? []).map(mapDocument);
}

/** Active (non-archived) tasks extracted from this meeting (`tasks.source_meeting_id`). */
export async function getMeetingTasks(meetingId: string): Promise<Task[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('source_meeting_id', meetingId)
    .eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error !== null) throw new Error(`getMeetingTasks: ${error.message}`);
  return (data ?? []).map(mapTask);
}

/** Master-record entries written for this meeting (`master_record_entries.meeting_id`). */
export async function getMeetingMasterRecord(meetingId: string): Promise<MasterRecordEntry[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('master_record_entries')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(`getMeetingMasterRecord: ${error.message}`);
  return (data ?? []).map(mapMasterRecordEntry);
}

/**
 * Our DURABLE transcript handle for a meeting, or null if none stored yet. Video is
 * never stored (`meeting_media.video_key` is always null — the page live-pulls it
 * from Recall), so this only carries the timestamped-segments key (served through
 * `/api/files/raw` / read server-side, gated by `canAccessKey`) + the duration.
 */
export interface MeetingMedia {
  readonly transcriptKey: string | null;
  readonly durationS: number | null;
}

export async function getMeetingMedia(meetingId: string): Promise<MeetingMedia | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meeting_media')
    .select('transcript_key, video_duration_s')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error !== null) {
    // Safe-deploy window: if migration 0014 hasn't been applied yet the table is
    // absent — degrade to "no recording" rather than crash the meeting page. Any
    // other error still surfaces.
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw new Error(`getMeetingMedia: ${error.message}`);
  }
  return data === null ? null : { transcriptKey: data.transcript_key, durationS: data.video_duration_s };
}

/**
 * Resolved ended-meeting player, assembled ON VIEW (no video is ever stored):
 *   - `videoUrl`  — a FRESH Recall mixed-video URL the browser streams DIRECTLY from
 *                   Recall's S3 (native seeking; ~5h signed, so re-fetched per view).
 *                   null when Recall has no recording (retention lapsed / never made).
 *   - `segments`  — timestamped transcript for click-to-seek. Our durable MinIO copy
 *                   when we have one; otherwise live-pulled from Recall AND cached
 *                   forward as a visible document (back-catalog lazy backfill). null
 *                   when there's no transcript to show (or it's access-restricted).
 */
export interface MeetingPlayback {
  readonly videoUrl: string | null;
  readonly segments: readonly TranscriptSegment[] | null;
}

export async function resolveMeetingPlayback(
  meeting: Meeting,
  media: MeetingMedia | null,
  role: Role,
): Promise<MeetingPlayback> {
  if (meeting.botJobId === null || meeting.botJobId === '') {
    return { videoUrl: null, segments: null };
  }
  const apiKey = await getCredential('recall');
  if (apiKey === null || apiKey === '') return { videoUrl: null, segments: null };
  const options = { apiKey, region: process.env.RECALL_REGION };

  let urls: Awaited<ReturnType<typeof fetchRecallRecordingUrls>>;
  try {
    urls = await fetchRecallRecordingUrls(meeting.botJobId, options);
  } catch {
    // Recall unreachable / bot gone → no live playback (page shows "no longer available").
    return { videoUrl: null, segments: null };
  }

  const storedKey = media?.transcriptKey ?? null;
  const storedAccessible = storedKey !== null ? await canAccessKey(storedKey, role) : false;
  const source = decideTranscriptSource({ storedKey, storedAccessible, liveUrl: urls.transcriptUrl });

  let segments: readonly TranscriptSegment[] | null = null;
  if (source.kind === 'stored') {
    segments = await readStoredSegments(source.key);
  } else if (source.kind === 'livepull') {
    segments = await livePullAndCacheTranscript(meeting, source.url, urls.durationS, role);
  }
  return { videoUrl: urls.videoUrl, segments };
}

/** Read our stored segments JSON from MinIO (best-effort — a bad/absent object → null). */
async function readStoredSegments(key: string): Promise<readonly TranscriptSegment[] | null> {
  try {
    const parsed = JSON.parse((await getObjectBytes(key)).toString('utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as TranscriptSegment[]) : null;
  } catch {
    return null;
  }
}

/**
 * Back-catalog lazy backfill: download the transcript from Recall, SHOW it, AND cache
 * it forward — the readable transcript as a VISIBLE `documents` row in the meeting's
 * existing occurrence folder (so it inherits that folder's `canAccessKey` governance),
 * the timestamped segments as backing JSON, and a `meeting_media` row so later views
 * use our durable copy. Reuses the meeting's occurrence folder (found via an existing
 * generated doc) rather than duplicating the worker's key scheme, and gates on that
 * same folder ACL. Caching is best-effort; a hiccup never blocks showing the transcript.
 */
async function livePullAndCacheTranscript(
  meeting: Meeting,
  transcriptUrl: string,
  durationS: number | null,
  role: Role,
): Promise<readonly TranscriptSegment[] | null> {
  const db = getServerClient();
  // The occurrence folder = where this meeting's generated docs already live.
  const { data: sibling } = await db
    .from('documents')
    .select('folder_id, r2_key')
    .eq('meeting_id', meeting.id)
    .eq('source_badge', 'meeting')
    .not('folder_id', 'is', null)
    .not('r2_key', 'is', null)
    .limit(1)
    .maybeSingle();
  const folderId = sibling?.folder_id ?? null;
  const siblingKey = sibling?.r2_key ?? null;

  // Same folder ACL as the meeting's docs: if the caller can't see those, don't
  // live-pull the transcript either (a live-pull must not bypass a restricted folder).
  if (folderId !== null && siblingKey !== null && !(await canAccessKey(siblingKey, role))) {
    return null;
  }

  const dl = await downloadRecallTranscript(transcriptUrl).catch(() => null);
  if (dl === null || dl.segments.length === 0) return null;

  // No occurrence folder to file a visible doc under (rare: an ended meeting with no
  // generated docs) → still show the live transcript, just don't cache it as a doc.
  if (folderId === null || siblingKey === null || meeting.clientId === null) {
    return dl.segments;
  }

  try {
    const prefix = siblingKey.slice(0, siblingKey.lastIndexOf('/'));
    const docKey = `${prefix}/transcript.md`;
    const segmentsKey = `${prefix}/transcript.json`;
    await putObject(docKey, Buffer.from(dl.text, 'utf8'), 'text/markdown');
    await putObject(segmentsKey, Buffer.from(JSON.stringify(dl.segments), 'utf8'), 'application/json');
    // Idempotent: drop any prior row for this exact key before inserting the visible doc.
    await db.from('documents').delete().eq('r2_key', docKey);
    await db.from('documents').insert({
      client_id: meeting.clientId,
      meeting_id: meeting.id,
      folder_id: folderId,
      document_type: 'other',
      source_badge: 'meeting',
      r2_key: docKey,
      file_name: 'transcript.md',
      file_size: Buffer.byteLength(dl.text, 'utf8'),
      requires_review: false,
      status: 'ready',
    });
    await db.from('meeting_media').upsert(
      {
        meeting_id: meeting.id,
        transcript_key: segmentsKey,
        video_key: null,
        video_duration_s: durationS,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'meeting_id' },
    );
  } catch {
    // Best-effort cache — never block showing the transcript on a storage/DB hiccup.
  }
  return dl.segments;
}

/** The latest pipeline run for a meeting (status + raw error), or null if none ran. */
export interface MeetingPipelineRun {
  readonly runStatus: 'success' | 'failed' | 'partial' | null;
  readonly errorMessage: string | null;
}

export async function getLatestPipelineRun(meetingId: string): Promise<MeetingPipelineRun | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('pipeline_runs')
    .select('status, error_message, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new Error(`getLatestPipelineRun: ${error.message}`);
  return data === null ? null : { runStatus: data.status, errorMessage: data.error_message };
}
