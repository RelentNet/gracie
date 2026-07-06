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
  Client,
  ClientType,
  ClientCadenceRow,
  ClientCadence,
  ExternalAttendee,
  MeetingOrg,
} from '@gracie/shared';
import { deriveOrgNameFromDomain, isFreeEmailDomain, parseInternalDomains } from '@gracie/shared';

import { mapExternalAttendees } from '../mappers/meeting.js';
import { createClient, normalizeDomain } from './clients.js';

const LAST_SCAN_SETTING_KEY = 'calendar_last_scan_at';
const INTERNAL_DOMAINS_SETTING_KEY = 'internal_email_domains';

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

/** The internal (GA) email domains from settings (default `graceandassociates.com`). */
async function loadInternalDomains(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', INTERNAL_DOMAINS_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`calendar.loadInternalDomains: ${error.message}`);
  return parseInternalDomains(typeof data?.value === 'string' ? data.value : null);
}

/** Every registered org domain (lower-cased) — the "known" set for unknown-domain calc. */
async function loadKnownDomains(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db.from('client_domains').select('domain');
  if (error !== null) throw new Error(`calendar.loadKnownDomains: ${error.message}`);
  return new Set((data ?? []).map((r) => r.domain.trim().toLowerCase()));
}

/** Linked orgs per meeting (from the `meeting_clients` junction), for chips. */
async function loadMeetingOrgs(
  db: ServerClient,
  meetingIds: readonly string[],
): Promise<Map<string, MeetingOrg[]>> {
  const map = new Map<string, MeetingOrg[]>();
  if (meetingIds.length === 0) return map;
  const { data, error } = await db
    .from('meeting_clients')
    .select('meeting_id, clients!inner(id, name, type)')
    .in('meeting_id', meetingIds);
  if (error !== null) throw new Error(`calendar.loadMeetingOrgs: ${error.message}`);
  for (const row of data ?? []) {
    const org = row.clients as unknown as MeetingOrg | null;
    if (org === null) continue;
    const list = map.get(row.meeting_id) ?? [];
    list.push({ id: org.id, name: org.name, type: org.type });
    map.set(row.meeting_id, list);
  }
  return map;
}

/**
 * External attendee domains that don't map to any org yet — the "create client /
 * lead" targets. Excludes internal + free-email + already-known domains. Computed
 * at read time so it stays correct as orgs are created.
 */
function computeUnknownDomains(
  externalAttendees: readonly ExternalAttendee[],
  internalDomains: ReadonlySet<string>,
  knownDomains: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const a of externalAttendees) {
    const domain = a.domain.trim().toLowerCase();
    if (domain === '') continue;
    if (internalDomains.has(domain) || isFreeEmailDomain(domain) || knownDomains.has(domain)) continue;
    out.add(domain);
  }
  return [...out];
}

/**
 * List meetings whose start falls within [fromIso, toIso], enriched for the grid
 * + day detail (P4.1): linked orgs, internal flag, external attendees, and the
 * computed unknown-org domains. Ordered by start time ascending.
 */
export async function listCalendarMeetings(
  fromIso: string,
  toIso: string,
): Promise<CalendarMeeting[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select(
      'id, client_id, title, date_time, duration_minutes, meeting_type, video_link, pipeline_status, bot_dispatched, is_internal, external_attendees, source, meeting_lead_user_id, attendee_user_ids',
    )
    .gte('date_time', fromIso)
    .lte('date_time', toIso)
    .order('date_time', { ascending: true });
  if (error !== null) throw new Error(`listCalendarMeetings: ${error.message}`);

  const rows = data ?? [];
  const [people, orgsByMeeting, internalDomains, knownDomains] = await Promise.all([
    loadPeople(db),
    loadMeetingOrgs(db, rows.map((m) => m.id)),
    loadInternalDomains(db),
    loadKnownDomains(db),
  ]);

  return rows.map((m) => {
    const orgs = orgsByMeeting.get(m.id) ?? [];
    const primary = m.client_id !== null ? orgs.find((o) => o.id === m.client_id) ?? null : null;
    const externalAttendees = mapExternalAttendees(m.external_attendees);
    return {
      id: m.id,
      clientId: m.client_id,
      clientName: primary?.name ?? null,
      title: m.title,
      dateTime: m.date_time,
      durationMinutes: m.duration_minutes,
      meetingType: m.meeting_type,
      videoLink: m.video_link,
      pipelineStatus: m.pipeline_status,
      isBotDispatched: m.bot_dispatched,
      isInternal: m.is_internal,
      source: m.source,
      lead: m.meeting_lead_user_id !== null ? (people.get(m.meeting_lead_user_id) ?? null) : null,
      attendees: toPeople(m.attendee_user_ids, people),
      orgs,
      externalAttendees,
      unknownOrgDomains: computeUnknownDomains(externalAttendees, internalDomains, knownDomains),
    };
  });
}

/**
 * List meetings needing attention for the Admin assignment list (P4.1): still
 * `scheduled`, calendar-sourced, not internal, and either unassigned (no primary
 * org) OR carrying an unknown external domain. Ordered by start time.
 */
export async function listAmbiguousMeetings(): Promise<AmbiguousMeeting[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('meetings')
    .select('id, title, date_time, video_link, attendee_user_ids, client_id, external_attendees')
    .eq('source', 'calendar')
    .eq('pipeline_status', 'scheduled')
    .eq('is_internal', false)
    .order('date_time', { ascending: true });
  if (error !== null) throw new Error(`listAmbiguousMeetings: ${error.message}`);

  const rows = data ?? [];
  const [people, orgsByMeeting, internalDomains, knownDomains] = await Promise.all([
    loadPeople(db),
    loadMeetingOrgs(db, rows.map((m) => m.id)),
    loadInternalDomains(db),
    loadKnownDomains(db),
  ]);

  const out: AmbiguousMeeting[] = [];
  for (const m of rows) {
    const unknownOrgDomains = computeUnknownDomains(
      mapExternalAttendees(m.external_attendees),
      internalDomains,
      knownDomains,
    );
    const hasClientOrg = (orgsByMeeting.get(m.id) ?? []).some((o) => o.type === 'client');
    // Needs attention when no client org is linked, or an unknown domain remains.
    if (hasClientOrg && unknownOrgDomains.length === 0) continue;
    out.push({
      id: m.id,
      title: m.title,
      dateTime: m.date_time,
      videoLink: m.video_link,
      attendees: toPeople(m.attendee_user_ids, people),
      unknownOrgDomains,
    });
  }
  return out;
}

/**
 * Admin action: assign a client to a meeting (resolving an ambiguous match).
 * Sets the primary `client_id` AND records the link in `meeting_clients` (so the
 * assignment shows as an org chip and counts toward bot eligibility). Throws if
 * the meeting or client is missing.
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

  await linkMeetingOrgRow(db, meetingId, clientId);
}

/** The GA `internal` org id (home for internal meetings), or null if absent. */
async function loadInternalOrgId(db: ServerClient): Promise<string | null> {
  const { data, error } = await db
    .from('clients')
    .select('id')
    .eq('type', 'internal')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new Error(`calendar.loadInternalOrgId: ${error.message}`);
  return data?.id ?? null;
}

/** Insert one meeting↔org link (idempotent; add-only). */
async function linkMeetingOrgRow(
  db: ServerClient,
  meetingId: string,
  clientId: string,
): Promise<void> {
  const { error } = await db
    .from('meeting_clients')
    .upsert({ meeting_id: meetingId, client_id: clientId }, {
      onConflict: 'meeting_id,client_id',
      ignoreDuplicates: true,
    });
  if (error !== null) throw new Error(`linkMeetingOrg: ${error.message}`);
}

/**
 * Recompute the denormalized primary `client_id` from the current links. Internal
 * meetings always home to the GA org. External meetings keep their current primary
 * if it's still linked (preserving an Admin choice), else fall to the
 * earliest-created linked non-internal org, else null.
 */
async function recomputePrimaryOrg(db: ServerClient, meetingId: string): Promise<void> {
  const meetingRes = await db
    .from('meetings')
    .select('id, client_id, is_internal')
    .eq('id', meetingId)
    .maybeSingle();
  if (meetingRes.error !== null) throw new Error(`recomputePrimaryOrg: ${meetingRes.error.message}`);
  const meeting = meetingRes.data;
  if (meeting === null) return;

  let next: string | null;
  if (meeting.is_internal) {
    next = await loadInternalOrgId(db);
  } else {
    const linksRes = await db
      .from('meeting_clients')
      .select('client_id, clients!inner(created_at, type)')
      .eq('meeting_id', meetingId);
    if (linksRes.error !== null) throw new Error(`recomputePrimaryOrg: ${linksRes.error.message}`);
    const orgs = (linksRes.data ?? [])
      .map((r) => {
        const c = r.clients as unknown as { created_at: string; type: ClientType };
        return { id: r.client_id, createdAt: c.created_at, type: c.type };
      })
      .filter((o) => o.type !== 'internal')
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    const stillLinked = meeting.client_id !== null && orgs.some((o) => o.id === meeting.client_id);
    next = stillLinked ? meeting.client_id : (orgs[0]?.id ?? null);
  }

  if (next !== meeting.client_id) {
    const upd = await db.from('meetings').update({ client_id: next }).eq('id', meetingId);
    if (upd.error !== null) throw new Error(`recomputePrimaryOrg: ${upd.error.message}`);
  }
}

/**
 * Link an existing org to a meeting (P4.1), then recompute the primary. Validates
 * both the meeting and the org exist.
 */
export async function linkMeetingOrg(meetingId: string, clientId: string): Promise<void> {
  const db = getServerClient();
  const clientRes = await db.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (clientRes.error !== null) throw new Error(`linkMeetingOrg: ${clientRes.error.message}`);
  if (clientRes.data === null) throw new Error('Unknown client');
  const meetingRes = await db.from('meetings').select('id').eq('id', meetingId).maybeSingle();
  if (meetingRes.error !== null) throw new Error(`linkMeetingOrg: ${meetingRes.error.message}`);
  if (meetingRes.data === null) throw new Error('Unknown meeting');
  await linkMeetingOrgRow(db, meetingId, clientId);
  await recomputePrimaryOrg(db, meetingId);
}

/** Unlink an org from a meeting (P4.1), then recompute the primary. */
export async function unlinkMeetingOrg(meetingId: string, clientId: string): Promise<void> {
  const db = getServerClient();
  const del = await db
    .from('meeting_clients')
    .delete()
    .eq('meeting_id', meetingId)
    .eq('client_id', clientId);
  if (del.error !== null) throw new Error(`unlinkMeetingOrg: ${del.error.message}`);
  await recomputePrimaryOrg(db, meetingId);
}

/** Input for creating a new org (client/prospect/lead/partner) from a meeting domain. */
export interface CreateOrgFromMeetingInput {
  readonly meetingId: string;
  readonly domain: string;
  readonly name?: string;
  readonly type?: ClientType;
  readonly primaryContact?: string | null;
  readonly primaryContactEmail?: string | null;
}

/**
 * Create a `client|prospect|lead|partner` from an unknown domain on a meeting
 * (P4.1 §6): inserts the org + its `client_domains` row, links this meeting, and
 * retroactively links every other meeting carrying that domain (setting the
 * primary where still unassigned). Rejects free-email and internal domains, and a
 * domain already owned by another org. Returns the created org.
 */
export async function createOrgFromMeeting(input: CreateOrgFromMeetingInput): Promise<Client> {
  const db = getServerClient();
  const domain = normalizeDomain(input.domain);
  if (domain === '') throw new Error('A domain is required.');
  if (isFreeEmailDomain(domain)) {
    throw new Error('Free-email domains can’t identify an organization.');
  }
  const internalDomains = await loadInternalDomains(db);
  if (internalDomains.has(domain)) throw new Error('That is an internal domain.');

  // Never create an `internal` org here (that's the reserved GA workspace).
  const type: ClientType =
    input.type !== undefined && input.type !== 'internal' ? input.type : 'client';

  const existingDomain = await db
    .from('client_domains')
    .select('client_id')
    .eq('domain', domain)
    .maybeSingle();
  if (existingDomain.error !== null) {
    throw new Error(`createOrgFromMeeting: ${existingDomain.error.message}`);
  }
  if (existingDomain.data !== null) {
    throw new Error('That domain already belongs to an organization.');
  }

  const meetingRes = await db.from('meetings').select('id').eq('id', input.meetingId).maybeSingle();
  if (meetingRes.error !== null) throw new Error(`createOrgFromMeeting: ${meetingRes.error.message}`);
  if (meetingRes.data === null) throw new Error('Unknown meeting');

  const name = (input.name ?? '').trim() !== '' ? (input.name as string).trim() : deriveOrgNameFromDomain(domain);
  const client = await createClient({
    name,
    type,
    primaryContact: input.primaryContact ?? null,
    primaryContactEmail: input.primaryContactEmail ?? null,
    domains: [domain],
  });

  // Retroactively link every (non-internal) meeting carrying this domain. We
  // filter in-process (not a jsonb operator) so the match is exact + portable.
  const affectedRes = await db
    .from('meetings')
    .select('id, client_id, is_internal, external_attendees')
    .eq('is_internal', false);
  if (affectedRes.error !== null) {
    throw new Error(`createOrgFromMeeting(retro): ${affectedRes.error.message}`);
  }
  const affected = (affectedRes.data ?? []).filter((m) =>
    mapExternalAttendees(m.external_attendees).some((a) => a.domain.trim().toLowerCase() === domain),
  );
  const linkIds = new Set(affected.map((m) => m.id));
  linkIds.add(input.meetingId); // always link the originating meeting

  const linkRows = [...linkIds].map((id) => ({ meeting_id: id, client_id: client.id }));
  const linked = await db
    .from('meeting_clients')
    .upsert(linkRows, { onConflict: 'meeting_id,client_id', ignoreDuplicates: true });
  if (linked.error !== null) throw new Error(`createOrgFromMeeting(link): ${linked.error.message}`);

  // Set the primary org where the meeting is still unassigned.
  const primaryTargets = affected.filter((m) => m.client_id === null).map((m) => m.id);
  primaryTargets.push(input.meetingId);
  const upd = await db
    .from('meetings')
    .update({ client_id: client.id })
    .in('id', [...new Set(primaryTargets)])
    .is('client_id', null);
  if (upd.error !== null) throw new Error(`createOrgFromMeeting(primary): ${upd.error.message}`);

  return client;
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
  const clientsRes = await db
    .from('clients')
    .select('id, name, cadence')
    .eq('type', 'client') // cadence is a client-only surface (P4.1)
    .order('name');
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
