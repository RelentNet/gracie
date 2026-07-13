/**
 * Automations data layer (P8). The single place every automations route + the
 * agentic action executor reads/writes `automations` / `automation_runs` /
 * `automation_requests`.
 *
 * SECURITY: the app uses the service-role client (RLS bypassed). Row scope (a user
 * sees/acts on their OWN automations; an admin on ALL) is enforced by the CALLING
 * ROUTE via `getRequestUser`/`isAdmin` — this layer takes explicit ids and never
 * derives identity from client input. Creation always stamps the caller as owner.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database, Json } from '@gracie/db';
import {
  ABSOLUTE_MIN_INTERVAL_MINUTES,
  DEFAULT_MIN_INTERVAL_MINUTES,
  describeSchedule,
  isEventSchedule,
  parseSchedule,
  type AutomationRequestStatus,
  type AutomationStatus,
  type AutomationType,
} from '@gracie/shared';

type AutomationRow = Database['public']['Tables']['automations']['Row'];
type AutomationRunRow = Database['public']['Tables']['automation_runs']['Row'];
type AutomationRequestRow = Database['public']['Tables']['automation_requests']['Row'];

/** The settings key holding the external-send master switch (JSON string). */
const EXTERNAL_SEND_SETTING_KEY = 'automations_external_send_enabled';

/** The settings key holding the configurable recurring-interval floor (JSON string, minutes). */
const MIN_INTERVAL_SETTING_KEY = 'automations_min_interval_minutes';

// --- views --------------------------------------------------------------------

/** List/detail view of one automation (camelCase; safe to return to the client). */
export interface AutomationView {
  readonly id: string;
  readonly ownerUserId: string;
  /** Owner display name — populated only for the admin (all-automations) view. */
  readonly ownerName: string | null;
  readonly title: string;
  readonly intent: string | null;
  readonly type: AutomationType;
  readonly params: Json;
  readonly schedule: Json;
  /** Human-readable schedule (e.g. "Every day at 7:00 AM ET" / "15 min before each client meeting"). */
  readonly scheduleLabel: string;
  /** True for an event trigger (before_meeting) — fires per matching meeting, no next run. */
  readonly isEventTrigger: boolean;
  readonly recipients: Json;
  readonly hasExternalRecipient: boolean;
  readonly status: AutomationStatus;
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One audit row for an automation run. */
export interface AutomationRunView {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly detail: string | null;
  readonly externalRecipients: readonly string[];
  readonly createdAt: string;
}

/** One advanced (out-of-catalog) request in the admin inbox. */
export interface AutomationRequestView {
  readonly id: string;
  readonly requestedByUserId: string | null;
  readonly requestedByName: string | null;
  readonly intent: string;
  readonly status: AutomationRequestStatus;
  readonly notes: string | null;
  readonly resolvedByUserId: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

function toView(row: AutomationRow, ownerName: string | null = null): AutomationView {
  // Parse the untrusted schedule JSON ONCE; derive both the label and the trigger kind.
  const parsed = parseSchedule(row.schedule);
  const scheduleLabel = 'schedule' in parsed ? describeSchedule(parsed.schedule) : 'Custom schedule';
  const isEventTrigger = 'schedule' in parsed && isEventSchedule(parsed.schedule);
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName,
    title: row.title,
    intent: row.intent,
    type: row.type as AutomationType,
    params: row.params,
    schedule: row.schedule,
    scheduleLabel,
    isEventTrigger,
    recipients: row.recipients,
    hasExternalRecipient: row.has_external_recipient,
    status: row.status as AutomationStatus,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- reads --------------------------------------------------------------------

/**
 * List automations. An admin sees ALL (with owner names); a non-admin sees only
 * their own. Pending-confirmation rows are included so the /automations page can
 * offer a Confirm/Cancel fallback if the chat card was missed.
 */
export async function listAutomations(params: {
  readonly userId: string;
  readonly isAdmin: boolean;
}): Promise<AutomationView[]> {
  const db = getServerClient();
  let query = db.from('automations').select('*').order('created_at', { ascending: false });
  if (!params.isAdmin) query = query.eq('owner_user_id', params.userId);

  const { data, error } = await query;
  if (error !== null) throw new Error(`listAutomations: ${error.message}`);
  const rows = data ?? [];

  if (!params.isAdmin) return rows.map((r) => toView(r));

  // Admin view: resolve owner display names in one lookup.
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const usersRes = await db.from('users').select('id, name').in('id', ownerIds);
    if (usersRes.error !== null) throw new Error(`listAutomations(owners): ${usersRes.error.message}`);
    for (const u of usersRes.data ?? []) names.set(u.id, u.name);
  }
  return rows.map((r) => toView(r, names.get(r.owner_user_id) ?? null));
}

/** Fetch one automation row (raw) for ownership checks; null if not found. */
export async function getAutomationRow(id: string): Promise<AutomationRow | null> {
  const db = getServerClient();
  const { data, error } = await db.from('automations').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getAutomationRow: ${error.message}`);
  return data;
}

/** Fetch one automation as a view; null if not found. */
export async function getAutomation(id: string): Promise<AutomationView | null> {
  const row = await getAutomationRow(id);
  return row === null ? null : toView(row);
}

/** Recent audit runs for an automation, newest first. */
export async function listAutomationRuns(automationId: string, limit = 20): Promise<AutomationRunView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('automation_runs')
    .select('*')
    .eq('automation_id', automationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error !== null) throw new Error(`listAutomationRuns: ${error.message}`);
  return (data ?? []).map((r: AutomationRunRow) => ({
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    detail: r.detail,
    externalRecipients: r.external_recipients,
    createdAt: r.created_at,
  }));
}

// --- writes -------------------------------------------------------------------

/** Parameters to create a pending-confirmation automation (caller = owner). */
export interface CreatePendingAutomationInput {
  readonly ownerUserId: string;
  readonly title: string;
  readonly intent: string | null;
  readonly type: AutomationType;
  readonly params: Json;
  readonly schedule: Json;
  readonly recipients: Json;
  readonly hasExternalRecipient: boolean;
}

/**
 * Persist a NEW automation in `pending_confirmation` (disabled, not scheduled). It
 * runs nothing until a deliberate Confirm flips it to active — this is the
 * confirm-before-acting guarantee at the data layer.
 */
export async function createPendingAutomation(input: CreatePendingAutomationInput): Promise<AutomationView> {
  const db = getServerClient();
  const { data, error } = await db
    .from('automations')
    .insert({
      owner_user_id: input.ownerUserId,
      title: input.title,
      intent: input.intent,
      type: input.type,
      params: input.params,
      schedule: input.schedule,
      recipients: input.recipients,
      has_external_recipient: input.hasExternalRecipient,
      status: 'pending_confirmation',
      enabled: false,
    })
    .select('*')
    .single();
  if (error !== null) throw new Error(`createPendingAutomation: ${error.message}`);
  return toView(data);
}

/**
 * Activate a confirmed automation: flip `pending_confirmation`/`paused` → `active`,
 * enable it, stamp `confirmed_at`, and set the first `next_run_at` from `firstRunAt`.
 * The caller (confirm route) has already re-validated + gated any external send.
 */
export async function activateAutomation(id: string, nextRunAtIso: string | null): Promise<AutomationView> {
  const db = getServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('automations')
    .update({
      status: 'active',
      enabled: true,
      confirmed_at: nowIso,
      next_run_at: nextRunAtIso,
      updated_at: nowIso,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error !== null) throw new Error(`activateAutomation: ${error.message}`);
  return toView(data);
}

/** Pause (enabled=false, status='paused') or resume (enabled=true, status='active'). */
export async function setAutomationPaused(id: string, paused: boolean, nextRunAtIso: string | null): Promise<AutomationView> {
  const db = getServerClient();
  const nowIso = new Date().toISOString();
  const patch: Database['public']['Tables']['automations']['Update'] = {
    status: paused ? 'paused' : 'active',
    enabled: !paused,
    updated_at: nowIso,
  };
  // Resuming re-anchors the schedule so a long-paused automation doesn't fire a
  // backlog; pausing leaves next_run_at untouched.
  if (!paused) patch.next_run_at = nextRunAtIso;
  const { data, error } = await db.from('automations').update(patch).eq('id', id).select('*').single();
  if (error !== null) throw new Error(`setAutomationPaused: ${error.message}`);
  return toView(data);
}

/** Delete an automation (cascades its runs). Returns true if a row was removed. */
export async function deleteAutomation(id: string): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db.from('automations').delete().eq('id', id).select('id');
  if (error !== null) throw new Error(`deleteAutomation: ${error.message}`);
  return (data ?? []).length > 0;
}

// --- advanced-requests inbox --------------------------------------------------

/** Insert an out-of-catalog request into the admin inbox. Returns its id. */
export async function createAutomationRequest(input: {
  readonly requestedByUserId: string;
  readonly intent: string;
}): Promise<string> {
  const db = getServerClient();
  const { data, error } = await db
    .from('automation_requests')
    .insert({ requested_by_user_id: input.requestedByUserId, intent: input.intent })
    .select('id')
    .single();
  if (error !== null) throw new Error(`createAutomationRequest: ${error.message}`);
  return data.id;
}

/** List advanced requests (admin inbox), newest first; optionally by status. */
export async function listAutomationRequests(status?: AutomationRequestStatus): Promise<AutomationRequestView[]> {
  const db = getServerClient();
  let query = db.from('automation_requests').select('*').order('created_at', { ascending: false });
  if (status !== undefined) query = query.eq('status', status);
  const { data, error } = await query;
  if (error !== null) throw new Error(`listAutomationRequests: ${error.message}`);
  const rows = data ?? [];

  const ids = [...new Set(rows.map((r) => r.requested_by_user_id).filter((v): v is string => v !== null))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const usersRes = await db.from('users').select('id, name').in('id', ids);
    if (usersRes.error !== null) throw new Error(`listAutomationRequests(users): ${usersRes.error.message}`);
    for (const u of usersRes.data ?? []) names.set(u.id, u.name);
  }
  return rows.map((r: AutomationRequestRow) => ({
    id: r.id,
    requestedByUserId: r.requested_by_user_id,
    requestedByName: r.requested_by_user_id !== null ? names.get(r.requested_by_user_id) ?? null : null,
    intent: r.intent,
    status: r.status as AutomationRequestStatus,
    notes: r.notes,
    resolvedByUserId: r.resolved_by_user_id,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

/** Resolve an advanced request (accept/dismiss) — admin only (route-gated). */
export async function resolveAutomationRequest(
  id: string,
  input: { readonly status: 'accepted' | 'dismissed'; readonly notes?: string | null; readonly resolvedByUserId: string },
): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('automation_requests')
    .update({
      status: input.status,
      notes: input.notes ?? null,
      resolved_by_user_id: input.resolvedByUserId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id');
  if (error !== null) throw new Error(`resolveAutomationRequest: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Count pending advanced requests (for the admin inbox badge). */
export async function countPendingAutomationRequests(): Promise<number> {
  const db = getServerClient();
  const { count, error } = await db
    .from('automation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error !== null) throw new Error(`countPendingAutomationRequests: ${error.message}`);
  return count ?? 0;
}

// --- interval floor -----------------------------------------------------------

/**
 * The configurable minimum interval (minutes) for a recurring automation (P8.1).
 * Read from `automations_min_interval_minutes` (default hourly); the Assistant passes
 * it to `parseSchedule` so the model can offer hourly but never sub-hourly. Clamped to
 * the absolute structural floor so a mis-set value never permits per-minute runs.
 */
export async function getAutomationsMinIntervalMinutes(): Promise<number> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', MIN_INTERVAL_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getAutomationsMinIntervalMinutes: ${error.message}`);
  const raw = typeof data?.value === 'string' ? Number.parseInt(data.value.trim(), 10) : NaN;
  const minutes = Number.isFinite(raw) ? raw : DEFAULT_MIN_INTERVAL_MINUTES;
  return Math.max(minutes, ABSOLUTE_MIN_INTERVAL_MINUTES);
}

// --- external-send master switch ----------------------------------------------

/** Read the external-send master switch (default OFF). */
export async function getAutomationsExternalSendEnabled(): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', EXTERNAL_SEND_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getAutomationsExternalSendEnabled: ${error.message}`);
  return typeof data?.value === 'string' && data.value.trim().toLowerCase() === 'true';
}

/** Set the external-send master switch (admin only — route-gated). */
export async function setAutomationsExternalSendEnabled(enabled: boolean, updatedByUserId: string): Promise<boolean> {
  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    {
      key: EXTERNAL_SEND_SETTING_KEY,
      // Stored JSON-encoded as a string ("true"/"false") to match the readers.
      value: enabled ? 'true' : 'false',
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setAutomationsExternalSendEnabled: ${error.message}`);
  return enabled;
}
