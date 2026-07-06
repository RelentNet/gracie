/**
 * Calendar-scan processor (P4, docs/07 §6, docs/09 Phase 4). A repeatable sweep
 * (~30 min, business hours ET) that:
 *
 *   1. lists the members of `MS_CALENDAR_GROUP_ID` (Graph, app-only),
 *   2. syncs `users.calendar_connected` from that membership (= "connected", D5),
 *   3. reads each member's `calendarView` for a short window,
 *   4. dedups the SAME meeting across attendees' calendars into one logical event,
 *   5. matches each event to a client (alias + attendee-domain; simple, no NLP),
 *   6. upserts a `meetings` row keyed by a stable dedup key (`calendar_event_id`).
 *
 * Matching outcome per event: 0 candidates → not a client meeting (skipped);
 * 1 → assigned; >1 → ambiguous (`client_id = null`, Admin assigns via the UI).
 *
 * Idempotent + non-destructive: an existing meeting that is already dispatched or
 * past `scheduled` is left untouched; a previously-ambiguous meeting is auto-
 * resolved only when matching now yields exactly one client. Never overwrites an
 * Admin-assigned `client_id`.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import type { CalendarScanJobPayload } from '@gracie/shared';

import {
  SCAN_LOOKAHEAD_HOURS,
  SCAN_LOOKBACK_MINUTES,
  isWithinBusinessHours,
} from '../lib/calendar-config.js';
import {
  buildClientMatchers,
  resolveClientCandidates,
  meetingDedupKey,
  type ClientMatchers,
} from '../lib/calendar-match.js';
import { createGraphClient, getGraphConfig, type GraphEvent } from '../lib/graph.js';

type MeetingInsert = Database['public']['Tables']['meetings']['Insert'];
type MeetingUpdate = Database['public']['Tables']['meetings']['Update'];

/** Outcome of one scan sweep (visible in Bull Board). */
export interface CalendarScanResult {
  readonly skipped: boolean;
  readonly reason?: string;
  readonly members: number;
  readonly events: number;
  readonly meetings: number;
  readonly created: number;
  readonly updated: number;
  readonly ambiguous: number;
}

function skipResult(reason: string): CalendarScanResult {
  return { skipped: true, reason, members: 0, events: 0, meetings: 0, created: 0, updated: 0, ambiguous: 0 };
}

/** An internal GA user, keyed by lower-cased email for attendee resolution. */
interface UserLite {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** The same meeting merged across every member calendar it appeared on. */
interface AggregatedMeeting {
  readonly dedupKey: string;
  readonly canonical: GraphEvent;
  /** Lower-cased emails of every group member whose calendar held this event. */
  readonly ownerEmails: Set<string>;
}

type UpsertOutcome = 'created' | 'created-ambiguous' | 'updated' | 'skipped';

/** Build the calendar-scan processor, logging through the worker's Fastify logger. */
export function createCalendarScanProcessor(
  logger: FastifyBaseLogger,
): Processor<CalendarScanJobPayload, CalendarScanResult> {
  return async (job: Job<CalendarScanJobPayload>): Promise<CalendarScanResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const now = new Date();

    // The scheduled sweep only works during business hours ET; a manually-enqueued
    // sweep (source='manual', e.g. an Admin "Sync now" or a test) runs any time.
    if (job.data.source !== 'manual' && !isWithinBusinessHours(now)) {
      log.info('calendar-scan: outside business hours — skipping');
      return skipResult('outside_business_hours');
    }

    const config = getGraphConfig();
    if (config === null) {
      log.warn('calendar-scan: MS Graph not configured (MS_* env) — skipping');
      return skipResult('graph_not_configured');
    }

    const graph = createGraphClient(config, log);

    // 1. Group members → sync users.calendar_connected.
    const members = await graph.listGroupMembers();
    const memberEmails = new Set(members.map((m) => m.email));
    const users = await loadUsers(db);
    await syncCalendarConnected(db, memberEmails, log);

    // 2. Client matchers (aliases + canonical names + contact domains).
    const matchers = await loadMatchers(db);

    // 3. Read each member's calendar window; aggregate by dedup key.
    const windowStart = new Date(now.getTime() - SCAN_LOOKBACK_MINUTES * 60_000).toISOString();
    const windowEnd = new Date(now.getTime() + SCAN_LOOKAHEAD_HOURS * 3_600_000).toISOString();
    const aggregated = new Map<string, AggregatedMeeting>();
    let eventCount = 0;

    for (const member of members) {
      const events = await graph.readCalendarView(member.id, windowStart, windowEnd);
      for (const event of events) {
        if (event.isCancelled || event.startUtc === null) continue;
        eventCount += 1;
        const key = meetingDedupKey({
          iCalUId: event.iCalUId,
          joinUrl: event.joinUrl,
          startUtc: event.startUtc,
          attendeeEmails: event.attendees.map((a) => a.email),
        });
        const existing = aggregated.get(key);
        if (existing === undefined) {
          aggregated.set(key, { dedupKey: key, canonical: event, ownerEmails: new Set([member.email]) });
        } else {
          existing.ownerEmails.add(member.email);
        }
      }
    }

    // 4. Match + upsert each unique meeting.
    const usersByEmail = new Map(users.map((u) => [u.email, u]));
    let created = 0;
    let updated = 0;
    let ambiguous = 0;

    for (const agg of aggregated.values()) {
      const outcome = await upsertMeeting(db, agg, matchers, usersByEmail);
      if (outcome === 'created') created += 1;
      else if (outcome === 'updated') updated += 1;
      else if (outcome === 'created-ambiguous') {
        created += 1;
        ambiguous += 1;
      }
    }

    // 5. Record the last successful scan for the connection panel.
    await recordLastScan(db, now, log);

    const result: CalendarScanResult = {
      skipped: false,
      members: members.length,
      events: eventCount,
      meetings: aggregated.size,
      created,
      updated,
      ambiguous,
    };
    log.info(result, 'calendar-scan sweep complete');
    return result;
  };
}

/** Load all GA users (id/email/name) with lower-cased emails for matching. */
async function loadUsers(db: ServerClient): Promise<UserLite[]> {
  const { data, error } = await db.from('users').select('id, email, name');
  if (error !== null) throw new Error(`calendar-scan: load users: ${error.message}`);
  return (data ?? []).map((u) => ({ id: u.id, email: u.email.trim().toLowerCase(), name: u.name }));
}

/**
 * Sync `users.calendar_connected` to reflect group membership (D5: "connected" =
 * being in the access group). Only writes rows whose flag actually changed.
 */
async function syncCalendarConnected(
  db: ServerClient,
  memberEmails: ReadonlySet<string>,
  log: FastifyBaseLogger,
): Promise<void> {
  const { data, error } = await db.from('users').select('id, email, calendar_connected');
  if (error !== null) throw new Error(`calendar-scan: load connection flags: ${error.message}`);
  let changed = 0;
  for (const row of data ?? []) {
    const desired = memberEmails.has(row.email.trim().toLowerCase());
    if (desired === row.calendar_connected) continue;
    const patched = await db.from('users').update({ calendar_connected: desired }).eq('id', row.id);
    if (patched.error !== null) {
      throw new Error(`calendar-scan: update calendar_connected: ${patched.error.message}`);
    }
    changed += 1;
  }
  if (changed > 0) log.info({ changed }, 'calendar-scan: synced calendar_connected');
}

/** Build the client matcher tables from the roster + aliases. */
async function loadMatchers(db: ServerClient): Promise<ClientMatchers> {
  const clientsRes = await db.from('clients').select('id, name, primary_contact_email');
  if (clientsRes.error !== null) throw new Error(`calendar-scan: load clients: ${clientsRes.error.message}`);
  const aliasesRes = await db.from('client_aliases').select('client_id, alias');
  if (aliasesRes.error !== null) throw new Error(`calendar-scan: load aliases: ${aliasesRes.error.message}`);

  return buildClientMatchers(
    (clientsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      primaryContactEmail: c.primary_contact_email,
    })),
    (aliasesRes.data ?? []).map((a) => ({ clientId: a.client_id, alias: a.alias })),
  );
}

/** Whole-minute duration between two ISO instants, or null. */
function computeDuration(startUtc: string, endUtc: string | null): number | null {
  if (endUtc === null) return null;
  const ms = Date.parse(endUtc) - Date.parse(startUtc);
  if (Number.isNaN(ms) || ms <= 0) return null;
  return Math.round(ms / 60_000);
}

/**
 * Internal GA user ids on this meeting: attendees + organizer + the members whose
 * calendars carried it (a member may own a copy without being in `attendees`).
 */
function resolveInternalUsers(agg: AggregatedMeeting, usersByEmail: ReadonlyMap<string, UserLite>): string[] {
  const ids = new Set<string>();
  const add = (email: string | null): void => {
    if (email === null) return;
    const user = usersByEmail.get(email.trim().toLowerCase());
    if (user !== undefined) ids.add(user.id);
  };
  for (const a of agg.canonical.attendees) add(a.email);
  add(agg.canonical.organizerEmail);
  for (const owner of agg.ownerEmails) add(owner);
  return [...ids];
}

/** The meeting lead: organizer, else a calendar-owner member, else first attendee. */
function resolveLead(
  agg: AggregatedMeeting,
  usersByEmail: ReadonlyMap<string, UserLite>,
  internalUserIds: readonly string[],
): string | null {
  const organizer = agg.canonical.organizerEmail;
  if (organizer !== null) {
    const user = usersByEmail.get(organizer.trim().toLowerCase());
    if (user !== undefined) return user.id;
  }
  for (const owner of agg.ownerEmails) {
    const user = usersByEmail.get(owner);
    if (user !== undefined) return user.id;
  }
  return internalUserIds[0] ?? null;
}

/**
 * Insert or refresh the `meetings` row for one aggregated meeting. Returns the
 * outcome for metric counting. See the module header for the non-destructive
 * update rules.
 */
async function upsertMeeting(
  db: ServerClient,
  agg: AggregatedMeeting,
  matchers: ClientMatchers,
  usersByEmail: ReadonlyMap<string, UserLite>,
): Promise<UpsertOutcome> {
  const event = agg.canonical;
  const startUtc = event.startUtc as string; // non-null: filtered before aggregation
  const attendeeEmails = [...event.attendees.map((a) => a.email), event.organizerEmail];
  const candidates = resolveClientCandidates({ subject: event.subject, attendeeEmails }, matchers);
  const internalUserIds = resolveInternalUsers(agg, usersByEmail);
  const leadUserId = resolveLead(agg, usersByEmail, internalUserIds);

  const existingRes = await db
    .from('meetings')
    .select('id, client_id, bot_dispatched, pipeline_status, source')
    .eq('calendar_event_id', agg.dedupKey)
    .maybeSingle();
  if (existingRes.error !== null) {
    throw new Error(`calendar-scan: lookup meeting: ${existingRes.error.message}`);
  }
  const existing = existingRes.data;

  if (existing === null) {
    // A brand-new event with no client match is not a client meeting → skip it.
    if (candidates.length === 0) return 'skipped';
    const clientId = candidates.length === 1 ? candidates[0] : null;
    const insert: MeetingInsert = {
      client_id: clientId,
      title: event.subject,
      date_time: startUtc,
      duration_minutes: computeDuration(startUtc, event.endUtc),
      meeting_lead_user_id: leadUserId,
      attendee_user_ids: internalUserIds,
      calendar_event_id: agg.dedupKey,
      video_link: event.joinUrl,
      pipeline_status: 'scheduled',
      source: 'calendar',
    };
    const inserted = await db.from('meetings').insert(insert);
    if (inserted.error !== null) {
      // A concurrent insert may have raced us on the unique dedup key — treat as
      // an update on the next sweep rather than failing the whole scan.
      if (inserted.error.code === '23505') return 'skipped';
      throw new Error(`calendar-scan: insert meeting: ${inserted.error.message}`);
    }
    return clientId === null ? 'created-ambiguous' : 'created';
  }

  // Leave in-flight / non-calendar meetings untouched (never disturb a dispatched
  // bot, an in-progress pipeline, or a manually-created meeting).
  if (existing.bot_dispatched || existing.pipeline_status !== 'scheduled' || existing.source !== 'calendar') {
    return 'skipped';
  }

  const patch: MeetingUpdate = {
    title: event.subject,
    date_time: startUtc,
    duration_minutes: computeDuration(startUtc, event.endUtc),
    meeting_lead_user_id: leadUserId,
    attendee_user_ids: internalUserIds,
    video_link: event.joinUrl,
  };
  // Auto-resolve a still-unassigned meeting only when matching is now unambiguous;
  // never overwrite an existing (Admin- or scan-) assigned client.
  if (existing.client_id === null && candidates.length === 1) {
    patch.client_id = candidates[0];
  }
  const patched = await db.from('meetings').update(patch).eq('id', existing.id);
  if (patched.error !== null) throw new Error(`calendar-scan: update meeting: ${patched.error.message}`);
  return 'updated';
}

/** Upsert the `calendar_last_scan_at` setting for the connection panel. */
async function recordLastScan(db: ServerClient, now: Date, log: FastifyBaseLogger): Promise<void> {
  const { error } = await db
    .from('settings')
    .upsert({ key: 'calendar_last_scan_at', value: now.toISOString() }, { onConflict: 'key' });
  if (error !== null) log.warn({ err: error.message }, 'calendar-scan: could not record last-scan time');
}
