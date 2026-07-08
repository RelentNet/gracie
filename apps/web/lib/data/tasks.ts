/**
 * Server-side data access for tasks + task notes (Phase 1B).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement
 * is the API layer's job (docs/02 §D14). Runs only on the server — never import
 * this into a client component. Mirrors lib/data/clients.ts.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import type { Task, TaskNote, TaskStatus } from '@gracie/shared';

import { mapTask, mapTaskNote } from '../mappers/task.js';

interface ListTasksOptions {
  readonly includeArchived?: boolean;
}

/** A manually-created client task (P2.1). Manual tasks carry no source meeting/document. */
export interface NewTaskInput {
  readonly clientId: string;
  readonly description: string;
  readonly ownerUserId?: string | null;
  /** `YYYY-MM-DD`, or null for no due date. */
  readonly dueDate?: string | null;
  readonly priorityFlag?: boolean;
}

/** A partial task edit (P2.1). Only the keys present are written. */
export interface TaskPatch {
  readonly description?: string;
  readonly ownerUserId?: string | null;
  readonly dueDate?: string | null;
  readonly status?: TaskStatus;
  readonly priorityFlag?: boolean;
  readonly archived?: boolean;
}

/**
 * Create a manual, client-scoped task (P2.1). `source_meeting_id`/`source_document_id`
 * stay null — the marker distinguishing a hand-added task from a pipeline-extracted one.
 */
export async function createTask(input: NewTaskInput): Promise<Task> {
  const db = getServerClient();
  const insert: Database['public']['Tables']['tasks']['Insert'] = {
    client_id: input.clientId,
    description: input.description.trim(),
    owner_user_id: input.ownerUserId ?? null,
    due_date: input.dueDate ?? null,
    priority_flag: input.priorityFlag ?? false,
    status: 'open',
  };
  const { data, error } = await db.from('tasks').insert(insert).select('*').single();
  if (error !== null) throw new Error(`createTask: ${error.message}`);
  return mapTask(data);
}

/** Update a task's editable fields (status/owner/due/priority/archive/description). */
export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const db = getServerClient();
  const update: Database['public']['Tables']['tasks']['Update'] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.description !== undefined) update.description = patch.description.trim();
  if (patch.ownerUserId !== undefined) update.owner_user_id = patch.ownerUserId;
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.priorityFlag !== undefined) update.priority_flag = patch.priorityFlag;
  if (patch.archived !== undefined) update.archived = patch.archived;

  const { data, error } = await db.from('tasks').update(update).eq('id', id).select('*').maybeSingle();
  if (error !== null) throw new Error(`updateTask: ${error.message}`);
  if (data === null) throw new Error('Unknown task');
  return mapTask(data);
}

/**
 * List tasks ordered by due date (asc, nulls last). Archived tasks are excluded
 * by default; pass `{ includeArchived: true }` to include them (M6 toggle).
 */
export async function listTasks(opts?: ListTasksOptions): Promise<Task[]> {
  const db = getServerClient();
  let query = db
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false });
  if (opts?.includeArchived !== true) {
    query = query.eq('archived', false);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listTasks: ${error.message}`);
  return (data ?? []).map(mapTask);
}

/** List all tasks for a single client, ordered by due date (asc, nulls last). */
export async function getTasksByClient(clientId: string): Promise<Task[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('client_id', clientId)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`getTasksByClient: ${error.message}`);
  return (data ?? []).map(mapTask);
}

/** List the append-only note feed for a task, oldest first. */
export async function getTaskNotes(taskId: string): Promise<TaskNote[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('task_notes')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getTaskNotes: ${error.message}`);
  return (data ?? []).map(mapTaskNote);
}
