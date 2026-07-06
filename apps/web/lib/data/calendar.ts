/**
 * Server-side data access for the Calendar module (P4, docs/08 §M7).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement is
 * the API layer's job (docs/02 §D14). Runs only on the server — never import into
 * a client component. Raw `meetings`/`users`/`clients` rows are enriched here into
 * the presentation view-models in `@gracie/shared` (types/calendar.ts) so the
 * client renders names/initials without a second lookup.
 *
 * The worker owns calendar WRITES (the P4 crons). This layer is read-mostly; the
 * only writes are the Admin "assign a client to an ambiguous meeting" action and
 * the per-user auto-join opt-out toggle.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';
import type {
  AmbiguousMeeting,
  CalendarConnection,
  CalendarConnectionStatus,
  CalendarMeeting,
  CalendarPerson,
  ClientCadenceRow,
  ClientCadence,
} from '@gracie/shared';

const LAST_SCAN_SETTING_KEY = 'calendar_last_scan_at';

/**
 * Global bot-dispatch kill-switch (safety-critical, P4). The worker dispatches
 * bots ONLY when this setting is exactly the string 'true'; a missing row or any
 * other value = disabled (fail-safe). Mirrors the worker's
 * `BOT_DISPATCH_ENABLED_SETTING_KEY` in bot-dispatch.processor.ts.
 */
const BOT_DISPATCH_SETTING_KEY = 'calendar_bot_dispatch_enabled';

/** Days per cadence for the overdue calc; `ad_hoc` has no fixed interval. */
const CADENCE_DAYS: Readonly<Record<ClientCadence, number | null>> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  qbr: 90,
  ad_hoc: null,
};

/** Load every user as a display person, keyed by id (for attendee/lead enrichment). */
async function loadPeople(db: ServerClient): Promise<Map<string, CalendarPerson>> {
  const { data, error } = await db.from('users').select('id, name, initials');
  if (error !== null) throw new Error(`calendar.loadPeople: ${error.message}`);
  return new Map((data ?? []).map((u) => [u.id, { id: u.id, name: u.name, initials: u.initials }]));
}

/** Load client id → canonical name. */
async function loadClientNames(db: ServerClient): Promise<Map<string, string>> {
  const { data, error } = await db.from('clients').select('id, name');
  if (error !== null) throw new Error(`calendar.loadClientNames: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

/** Resolve a list of user ids to people, dropping unknown ids. */
function toPeople(
  ids: readonly string[],
  people: ReadonlyMap<string, CalendarPerson>,
): CalendarPerson[] {
  return ids.flatMap((id) => {
    const person = people.get(id);
    return person !== undefined ? [person] : [];
  });
}

/**
 * List meetings whose start falls within [fromIso, toIso], enriched for the grid
 * + day detail. Ordered by start time ascending.
 */
export async function listCalendarMeetings(
  fromIso: string,
  toIso: string,
): Promise<CalendarMeeting[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select(
      'id, client_id, title, date_time, duration_minutes, meeting_type, video_link, pipeline_status, bot_dispatched, source, meeting_lead_user_id, attendee_user_ids',
    )
    .gte('date_time', fromIso)
    .lte('date_time', toIso)
    .order('date_time', { ascending: true });
  if (error !== null) throw new Error(`listCalendarMeetings: ${error.message}`);

  const [people, clientNames] = await Promise.all([loadPeople(db), loadClientNames(db)]);
  return (data ?? []).map((m) => ({
    id: m.id,
    clientId: m.client_id,
    clientName: m.client_id !== null ? (clientNames.get(m.client_id) ?? null) : null,
    title: m.title,
    dateTime: m.date_time,
    durationMinutes: m.duration_minutes,
    meetingType: m.meeting_type,
    videoLink: m.video_link,
    pipelineStatus: m.pipeline_status,
    isBotDispatched: m.bot_dispatched,
    source: m.source,
    lead: m.meeting_lead_user_id !== null ? (people.get(m.meeting_lead_user_id) ?? null) : null,
    attendees: toPeople(m.attendee_user_ids, people),
  }));
}

/**
 * List meetings the scan flagged ambiguous (client unassigned, still scheduled,
 * calendar-sourced) for the Admin assignment list. Ordered by start time.
 */
export async function listAmbiguousMeetings(): Promise<AmbiguousMeeting[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select('id, title, date_time, video_link, attendee_user_ids')
    .is('client_id', null)
    .eq('source', 'calendar')
    .eq('pipeline_status', 'scheduled')
    .order('date_time', { ascending: true });
  if (error !== null) throw new Error(`listAmbiguousMeetings: ${error.message}`);

  const people = await loadPeople(db);
  return (data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    dateTime: m.date_time,
    videoLink: m.video_link,
    attendees: toPeople(m.attendee_user_ids, people),
  }));
}

/**
 * Admin action: assign a client to a meeting (resolving an ambiguous match).
 * Validates the client exists; throws if the meeting or client is missing.
 */
export async function assignMeetingClient(meetingId: string, clientId: string): Promise<void> {
  const db = getServerClient();
  const clientRes = await db.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (clientRes.error !== null) throw new Error(`assignMeetingClient: ${clientRes.error.message}`);
  if (clientRes.data === null) throw new Error('Unknown client');

  const updated = await db
    .from('meetings')
    .update({ client_id: clientId })
    .eq('id', meetingId)
    .select('id');
  if (updated.error !== null) throw new Error(`assignMeetingClient: ${updated.error.message}`);
  if ((updated.data ?? []).length === 0) throw new Error('Unknown meeting');
}

/** Read the last-scan timestamp recorded by the worker (or null if never run). */
async function getLastScanAt(db: ServerClient): Promise<string | null> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', LAST_SCAN_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`calendar.getLastScanAt: ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

/**
 * Team calendar-connection status (= access-group membership, D5). `self` is the
 * caller's row; `members` is the whole team for Admins and just `self` otherwise.
 * `groupConfigured` is derived from whether a scan has ever run (the web app does
 * not hold the MS Graph creds — only the worker does).
 */
export async function getConnectionStatus(
  currentLogtoId: string,
  isAdmin: boolean,
): Promise<CalendarConnectionStatus> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .select('id, name, email, initials, calendar_connected, logto_id')
    .is('deactivated_at', null)
    .order('name', { ascending: true });
  if (error !== null) throw new Error(`getConnectionStatus: ${error.message}`);

  const rows = data ?? [];
  const toConnection = (r: (typeof rows)[number]): CalendarConnection => ({
    userId: r.id,
    name: r.name,
    email: r.email,
    initials: r.initials,
    isConnected: r.calendar_connected,
  });
  const selfRow = rows.find((r) => r.logto_id === currentLogtoId) ?? null;
  const self = selfRow !== null ? toConnection(selfRow) : null;
  const members = isAdmin ? rows.map(toConnection) : self !== null ? [self] : [];
  const lastSyncedAt = await getLastScanAt(db);

  return { groupConfigured: lastSyncedAt !== null, lastSyncedAt, self, members };
}

/**
 * Per-client cadence tracker: last meeting, next scheduled meeting, and whether
 * the client is overdue (cadence interval lapsed with nothing upcoming).
 */
export async function listClientCadence(): Promise<ClientCadenceRow[]> {
  const db = getServerClient();
  const clientsRes = await db.from('clients').select('id, name, cadence').order('name');
  if (clientsRes.error !== null) throw new Error(`listClientCadence: ${clientsRes.error.message}`);

  const meetingsRes = await db
    .from('meetings')
    .select('client_id, date_time, pipeline_status')
    .not('client_id', 'is', null)
    .neq('pipeline_status', 'cancelled');
  if (meetingsRes.error !== null) throw new Error(`listClientCadence: ${meetingsRes.error.message}`);

  const nowMs = Date.now();
  const lastByClient = new Map<string, string>();
  const nextByClient = new Map<string, string>();
  for (const m of meetingsRes.data ?? []) {
    if (m.client_id === null) continue;
    const ms = Date.parse(m.date_time);
    if (Number.isNaN(ms)) continue;
    if (ms <= nowMs) {
      const cur = lastByClient.get(m.client_id);
      if (cur === undefined || ms > Date.parse(cur)) lastByClient.set(m.client_id, m.date_time);
    } else {
      const cur = nextByClient.get(m.client_id);
      if (cur === undefined || ms < Date.parse(cur)) nextByClient.set(m.client_id, m.date_time);
    }
  }

  return (clientsRes.data ?? []).map((c) => {
    const lastMeetingAt = lastByClient.get(c.id) ?? null;
    const nextMeetingAt = nextByClient.get(c.id) ?? null;
    const intervalDays = CADENCE_DAYS[c.cadence];
    const isOverdue =
      intervalDays !== null &&
      nextMeetingAt === null &&
      lastMeetingAt !== null &&
      nowMs - Date.parse(lastMeetingAt) > intervalDays * 86_400_000;
    return {
      clientId: c.id,
      clientName: c.name,
      cadence: c.cadence,
      lastMeetingAt,
      nextMeetingAt,
      isOverdue,
    };
  });
}

/**
 * Read the global bot-dispatch kill-switch (Admin-only control). Enabled ONLY
 * when the stored value is exactly 'true'; otherwise disabled (fail-safe OFF).
 */
export async function getBotDispatchEnabled(): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', BOT_DISPATCH_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getBotDispatchEnabled: ${error.message}`);
  return data?.value === 'true';
}

/**
 * Flip the global bot-dispatch kill-switch (Admin-only). Persists the exact
 * strings 'true'/'false' so the worker's `=== 'true'` check stays fail-safe.
 * Returns the new value.
 */
export async function setBotDispatchEnabled(enabled: boolean): Promise<boolean> {
  const db = getServerClient();
  const { error } = await db
    .from('settings')
    .upsert({ key: BOT_DISPATCH_SETTING_KEY, value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
  if (error !== null) throw new Error(`setBotDispatchEnabled: ${error.message}`);
  return enabled;
}

/** Read the caller's auto-join preference (defaults to true when no profile row). */
export async function getAutoJoin(logtoId: string): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .select('auto_join_meetings')
    .eq('logto_id', logtoId)
    .maybeSingle();
  if (error !== null) throw new Error(`getAutoJoin: ${error.message}`);
  return data?.auto_join_meetings ?? true;
}

/**
 * Set the caller's auto-join preference. Returns `updated: false` when the session
 * maps to no `users` row (e.g. local mock auth) so the route can 404 cleanly.
 */
export async function setAutoJoin(
  logtoId: string,
  value: boolean,
): Promise<{ updated: boolean; value: boolean }> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .update({ auto_join_meetings: value })
    .eq('logto_id', logtoId)
    .select('id');
  if (error !== null) throw new Error(`setAutoJoin: ${error.message}`);
  return { updated: (data ?? []).length > 0, value };
}
