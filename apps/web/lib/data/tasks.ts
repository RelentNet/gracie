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
import {
  combineMergedTasks,
  decideCapEvictions,
  decideTaskUpsert,
  findDuplicateTask,
  resolveOwnerFromText,
  tasksShareClient,
} from '@gracie/shared/tasks';

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
 * Permanently delete a task (admin-only, enforced at the API layer). This is the ONE
 * hard-delete path — regular flows only archive (a recoverable status). `task_notes`
 * cascade-delete via their FK. Idempotent: deleting an unknown id is a no-op.
 */
export async function deleteTask(id: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('tasks').delete().eq('id', id);
  if (error !== null) throw new Error(`deleteTask: ${error.message}`);
}

/**
 * Permanently delete many tasks in one round-trip (admin-only, enforced at the API).
 * The bulk sibling of {@link deleteTask} — one `.in('id', ids)` delete for clearing an
 * oversized board fast. `task_notes` cascade via their FK. Idempotent (unknown ids are
 * no-ops); an empty list is a no-op. Returns how many ids were requested.
 */
export async function deleteTasks(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getServerClient();
  const { error } = await db.from('tasks').delete().in('id', ids as string[]);
  if (error !== null) throw new Error(`deleteTasks: ${error.message}`);
  return ids.length;
}

/**
 * Merge 2+ same-client tasks into the first-selected survivor (admin-only, enforced at
 * the API). Folds the merged-away descriptions into the survivor + takes the highest
 * priority (pure {@link combineMergedTasks}), RE-PARENTS their notes onto the survivor
 * so history survives, then hard-deletes them. Rejects a cross-client selection — a task
 * belongs to one client. `primaryId` is the survivor; `mergedIds` are absorbed.
 * ponytail: no cross-row transaction (reparent → update → delete run in sequence); a
 * mid-way failure surfaces as an error and leaves rows intact-but-partially-moved —
 * acceptable for rare admin cleanup, wrap in an RPC if it ever matters.
 */
export async function mergeTasks(primaryId: string, mergedIds: readonly string[]): Promise<Task> {
  if (mergedIds.length === 0) throw new Error('Select at least two tasks to merge.');
  const db = getServerClient();
  const ids = [primaryId, ...mergedIds];

  const { data, error } = await db.from('tasks').select('*').in('id', ids);
  if (error !== null) throw new Error(`mergeTasks: ${error.message}`);
  const rows = data ?? [];

  // Preserve selection order (primary first) so the survivor is inputs[0] for the combine.
  const inputs = ids.map((id) => {
    const row = rows.find((r) => r.id === id);
    if (row === undefined) throw new Error('Unknown task');
    return { clientId: row.client_id, description: row.description, priorityFlag: row.priority_flag };
  });
  if (!tasksShareClient(inputs)) throw new Error('Merge only works within one client.');

  const combined = combineMergedTasks(inputs);

  // Re-parent the merged-away tasks' notes onto the survivor before deleting them.
  const reparent = await db
    .from('task_notes')
    .update({ task_id: primaryId })
    .in('task_id', mergedIds as string[]);
  if (reparent.error !== null) throw new Error(`mergeTasks: reparent notes: ${reparent.error.message}`);

  const survivor = await updateTask(primaryId, {
    description: combined.description,
    priorityFlag: combined.priorityFlag,
  });

  await deleteTasks(mergedIds);
  return survivor;
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

/** What a dictated in-meeting action item did to the client's task list. */
export type VoiceActionItemOutcome = 'insert' | 'escalate' | 'reactivate';

/**
 * Create a client task from a dictated in-meeting "action item" (the voice path). Runs the
 * SAME lifecycle rules the meeting pipeline uses so a spoken item never piles a duplicate:
 *   - DEDUP against the client's still-live tasks (active OR archived, never complete). A
 *     match escalates (active) or reactivates (archived) instead of inserting a duplicate.
 *   - Owner-on-name: assigned only when a staffer is clearly named in the text.
 *   - After applying, the active list is capped (stalest STANDARD tasks archive first).
 * A dictated item is high-confidence, so it is always HIGH. `source_meeting_id` is stamped
 * so it shows against the meeting like pipeline-extracted tasks. Returns which action ran
 * (for the in-meeting chat confirmation). Mirrors generate.processor.applyExtractedTasks
 * for a single item — but never clears the meeting's other tasks (that's a full-run concern).
 */
export async function createVoiceActionItem(
  clientId: string,
  meetingId: string,
  description: string,
): Promise<VoiceActionItemOutcome> {
  const db = getServerClient();
  const desc = description.trim();

  const existing = await db.from('tasks').select('id, description, archived, status').eq('client_id', clientId);
  if (existing.error !== null) throw new Error(`createVoiceActionItem: load existing: ${existing.error.message}`);
  const candidates = (existing.data ?? [])
    .filter((task) => task.archived || task.status !== 'complete')
    .map((task) => ({ id: task.id, description: task.description, archived: task.archived }));

  const match = findDuplicateTask(desc, candidates);
  // Dictated = high-confidence → priority:true (insert HIGH; a match escalates/reactivates to HIGH).
  const decision = decideTaskUpsert({ priority: true }, match);
  const nowIso = new Date().toISOString();

  if (decision.kind === 'insert') {
    const usersRes = await db.from('users').select('id, name, email');
    if (usersRes.error !== null) throw new Error(`createVoiceActionItem: load users: ${usersRes.error.message}`);
    const row: Database['public']['Tables']['tasks']['Insert'] = {
      client_id: clientId,
      source_meeting_id: meetingId,
      description: desc,
      owner_user_id: resolveOwnerFromText(desc, usersRes.data ?? []),
      priority_flag: true,
      status: 'open',
    };
    const ins = await db.from('tasks').insert(row).select('id').single();
    if (ins.error !== null) throw new Error(`createVoiceActionItem: insert: ${ins.error.message}`);
  } else if (decision.kind === 'escalate') {
    const upd = await db.from('tasks').update({ priority_flag: true, updated_at: nowIso }).eq('id', decision.id);
    if (upd.error !== null) throw new Error(`createVoiceActionItem: escalate: ${upd.error.message}`);
  } else {
    const upd = await db
      .from('tasks')
      .update({ archived: false, status: 'open', priority_flag: true, updated_at: nowIso })
      .eq('id', decision.id);
    if (upd.error !== null) throw new Error(`createVoiceActionItem: reactivate: ${upd.error.message}`);
  }

  // Cap the active list per client so the voice path isn't a backdoor around the pipeline's
  // "keep it short" rule: archive the stalest STANDARD tasks over the cap (high never evicts).
  const activeRes = await db
    .from('tasks')
    .select('id, priority_flag, updated_at, created_at')
    .eq('client_id', clientId)
    .eq('archived', false)
    .neq('status', 'complete');
  if (activeRes.error !== null) throw new Error(`createVoiceActionItem: load active: ${activeRes.error.message}`);
  const evictIds = decideCapEvictions(
    (activeRes.data ?? []).map((task) => ({
      id: task.id,
      priorityFlag: task.priority_flag,
      updatedAt: task.updated_at,
      createdAt: task.created_at,
    })),
  );
  if (evictIds.length > 0) {
    const archived = await db.from('tasks').update({ archived: true, updated_at: nowIso }).in('id', evictIds);
    if (archived.error !== null) throw new Error(`createVoiceActionItem: cap-evict: ${archived.error.message}`);
  }

  return decision.kind;
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
