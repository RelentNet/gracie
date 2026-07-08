/**
 * Server-side data access for the client-detail tabs (Phase 1B).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement
 * is the API layer's job (docs/02 §D14). Runs only on the server — never import
 * this into a client component. Mirrors lib/data/clients.ts (the template).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import type {
  Client,
  ClientNote,
  MasterRecordEntry,
  Meeting,
  Task,
} from '@gracie/shared';

import { getClient } from './clients.js';
import { mapClientNote, mapMasterRecordEntry } from '../mappers/client-extras.js';
import { mapMeeting } from '../mappers/meeting.js';
import { mapTask } from '../mappers/task.js';

/** Fetch a single client by id, or null if not found (delegates to the clients template). */
export async function getClientDetail(id: string): Promise<Client | null> {
  return getClient(id);
}

/** All meetings for a client, newest first. */
export async function getClientMeetings(id: string): Promise<Meeting[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select('*')
    .eq('client_id', id)
    .order('date_time', { ascending: false });
  if (error) throw new Error(`getClientMeetings: ${error.message}`);
  return (data ?? []).map(mapMeeting);
}

/** The most recent meeting for a client, or null if none. */
export async function getLatestClientMeeting(id: string): Promise<Meeting | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select('*')
    .eq('client_id', id)
    .order('date_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestClientMeeting: ${error.message}`);
  return data === null ? null : mapMeeting(data);
}

/**
 * Active (non-archived) tasks for a client, oldest-created first. Callers
 * decide whether to further filter to open items (Overview) or keep the full
 * active board (Operations / completion rate).
 */
export async function getClientTasks(id: string): Promise<Task[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('client_id', id)
    .eq('archived', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getClientTasks: ${error.message}`);
  return (data ?? []).map(mapTask);
}

/** All notes for a client, newest first. */
export async function getClientNotes(id: string): Promise<ClientNote[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('client_notes')
    .select('*')
    .eq('client_id', id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getClientNotes: ${error.message}`);
  return (data ?? []).map(mapClientNote);
}

/** Fetch a single client note by id, or null if not found (for ownership checks). */
export async function getClientNote(id: string): Promise<ClientNote | null> {
  const db = getServerClient();
  const { data, error } = await db.from('client_notes').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getClientNote: ${error.message}`);
  return data === null ? null : mapClientNote(data);
}

/** Create a client note (P2.1). `authorUserId` is the resolved request user (nullable pre-Logto). */
export async function createClientNote(
  clientId: string,
  content: string,
  authorUserId: string | null,
): Promise<ClientNote> {
  const db = getServerClient();
  const insert: Database['public']['Tables']['client_notes']['Insert'] = {
    client_id: clientId,
    content: content.trim(),
    author_user_id: authorUserId,
  };
  const { data, error } = await db.from('client_notes').insert(insert).select('*').single();
  if (error !== null) throw new Error(`createClientNote: ${error.message}`);
  return mapClientNote(data);
}

/** Edit a client note's content (P2.1). Ownership (author-or-admin) is gated by the API. */
export async function updateClientNote(id: string, content: string): Promise<ClientNote> {
  const db = getServerClient();
  const { data, error } = await db
    .from('client_notes')
    .update({ content: content.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateClientNote: ${error.message}`);
  if (data === null) throw new Error('Unknown note');
  return mapClientNote(data);
}

/** Delete a client note (P2.1). Ownership (author-or-admin) is gated by the API. */
export async function deleteClientNote(id: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('client_notes').delete().eq('id', id);
  if (error !== null) throw new Error(`deleteClientNote: ${error.message}`);
}

/** Master-record chronology for a client, newest first. */
export async function getClientMasterRecord(id: string): Promise<MasterRecordEntry[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('master_record_entries')
    .select('*')
    .eq('client_id', id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getClientMasterRecord: ${error.message}`);
  return (data ?? []).map(mapMasterRecordEntry);
}
