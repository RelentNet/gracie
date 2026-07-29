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

import { getServerClient } from '@gracie/db';
import type { Document, MasterRecordEntry, Meeting, Task } from '@gracie/shared';

import { mapMasterRecordEntry } from '../mappers/client-extras.js';
import { mapDocument } from '../mappers/document.js';
import { mapMeeting } from '../mappers/meeting.js';
import { mapTask } from '../mappers/task.js';

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
