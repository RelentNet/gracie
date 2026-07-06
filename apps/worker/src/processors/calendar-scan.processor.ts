/**
 * Calendar-scan processor (P4.1, docs/plan p4.1-meetings-first-orgs.md §4). A
 * repeatable sweep (~30 min, business hours ET) that turns Outlook into a
 * meetings-first workspace:
 *
 *   1. lists the members of `MS_CALENDAR_GROUP_ID` (Graph, app-only),
 *   2. syncs `users.calendar_connected` from that membership (= "connected", D5),
 *   3. reads each member's `calendarView` for a short window,
 *   4. dedups the SAME meeting across attendees' calendars into one logical event,
 *   5. resolves each meeting's org(s) from external attendee DOMAINS (multi-client
 *      via the `meeting_clients` junction; internal-only meetings → the GA org),
 *   6. upserts a `meetings` row keyed by a stable dedup key (`calendar_event_id`),
 *      capturing `is_internal` + `external_attendees` and linking matched orgs.
 *
 * EVERY real meeting is ingested now (not just client-matched ones) — solo
 * calendar blocks (no join URL AND ≤1 attendee) and cancelled/undated events are
 * the only skips. Matching is DOMAIN-FIRST (no subject/alias guessing).
 *
 * Reconciliation (P4.2): after upserting, the sweep REMOVES any calendar-sourced
 * meeting in the scan window that is no longer on any current group member's
 * calendar — this is how a cancelled meeting (dropped/`isCancelled`) and a
 * meeting orphaned by a member leaving the access group both disappear. Only
 * upcoming, still-`scheduled`, not-yet-dispatched meetings are eligible, so
 * processed history (bots/transcripts/documents) is preserved. Reconciliation is
 * SKIPPED whenever any member's calendar read failed (403/404/transient), so a
 * read we couldn't complete never causes a deletion (fail-safe).
 *
 * Idempotent + non-destructive elsewhere: an existing meeting that is already
 * dispatched or past `scheduled` is left untouched; `meeting_clients` links are
 * only ADDED, never removed (Admin/manual links + previously-created orgs are
 * sticky); the denormalized primary `client_id` is set only when currently null.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, Json, ServerClient } from '@gracie/db';
import {
  parseInternalDomains,
  type CalendarScanJobPayload,
  type ExternalAttendee,
} from '@gracie/shared';

import {
  SCAN_LOOKAHEAD_DAYS,
  SCAN_LOOKBACK_MINUTES,
  isWithinBusinessHours,
} from '../lib/calendar-config.js';
import {
  meetingDedupKey,
  resolveMeetingOrgs,
  type OrgDomainEntry,
} from '../lib/calendar-match.js';
import { createGraphClient, getGraphConfig, type GraphEvent } from '../lib/graph.js';

type MeetingInsert = Database['public']['Tables']['meetings']['Insert'];
type MeetingUpdate = Database['public']['Tables']['meetings']['Update'];

/** Cast typed external attendees to the raw jsonb column type for a DB write. */
function toJson(attendees: readonly ExternalAttendee[]): Json {
  return attendees as unknown as Json;
}

/** Outcome of one scan sweep (visible in Bull Board). */
export interface CalendarScanResult {
  readonly skipped: boolean;
  readonly reason?: string;
  readonly members: number;
  readonly events: number;
  readonly meetings: number;
  readonly created: number;
  readonly updated: number;
  /** Ingested meetings tagged internal (GA-only). */
  readonly internal: number;
  /** Created meetings with no linked org and not internal (need attention). */
  readonly unassigned: number;
  /** Removed meetings (cancelled or orphaned by a member leaving the group). */
  readonly reaped: number;
  /** Existing scheduled meetings whose is_internal / attendees were recomputed
   *  against the current internal-domain list (e.g. after 0005 added the GA
   *  onmicrosoft tenant domain). */
  readonly reclassified: number;
}

function skipResult(reason: string): CalendarScanResult {
  return {
    skipped: true,
    reason,
    members: 0,
    events: 0,
    meetings: 0,
    created: 0,
    updated: 0,
    internal: 0,
    unassigned: 0,
    reaped: 0,
    reclassified: 0,
  };
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

/** Resolved scan context: matcher tables + the internal-org home. */
interface ScanContext {
  readonly internalDomains: ReadonlySet<string>;
  readonly domainToOrg: ReadonlyMap<string, OrgDomainEntry>;
  /** The GA `internal` org id (home for internal meetings), or null if absent. */
  readonly internalOrgId: string | null;
}

type UpsertOutcome = 'created' | 'created-internal' | 'created-unassigned' | 'updated' | 'skipped';

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

    // 2. Matcher context: internal domains, domain→org map, GA internal org.
    const ctx = await loadScanContext(db);

    // 3. Read each member's calendar window; aggregate by dedup key. Track whether
    //    EVERY read succeeded — reconciliation only reaps on a fully-clean sweep.
    const windowStart = new Date(now.getTime() - SCAN_LOOKBACK_MINUTES * 60_000).toISOString();
    const windowEnd = new Date(now.getTime() + SCAN_LOOKAHEAD_DAYS * 86_400_000).toISOString();
    const aggregated = new Map<string, AggregatedMeeting>();
    let eventCount = 0;
    let allReadsOk = true;

    for (const member of members) {
      const { ok, events } = await graph.readCalendarView(member.id, windowStart, windowEnd);
      if (!ok) allReadsOk = false;
      for (const event of events) {
        if (event.isCancelled || event.startUtc === null) continue;
        // Skip solo calendar blocks (personal holds / focus time): no join URL AND
        // at most one attendee — never a real meeting.
        if (event.joinUrl === null && event.attendees.length <= 1) continue;
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

    // 4. Resolve + upsert each unique meeting.
    const usersByEmail = new Map(users.map((u) => [u.email, u]));
    let created = 0;
    let updated = 0;
    let internal = 0;
    let unassigned = 0;

    for (const agg of aggregated.values()) {
      const outcome = await upsertMeeting(db, agg, ctx, usersByEmail);
      if (outcome === 'updated') updated += 1;
      else if (outcome === 'created') created += 1;
      else if (outcome === 'created-internal') {
        created += 1;
        internal += 1;
      } else if (outcome === 'created-unassigned') {
        created += 1;
        unassigned += 1;
      }
    }

    // 5. Reconcile: remove upcoming, still-scheduled calendar meetings that are no
    //    longer on any group member's calendar (cancelled, or orphaned by someone
    //    leaving the group). Only on a fully-clean sweep, so a failed read can't
    //    trigger deletions.
    let reaped = 0;
    if (allReadsOk && members.length > 0) {
      reaped = await reconcileRemovedMeetings(db, aggregated, windowStart, windowEnd, log);
    } else {
      // A failed read (403/transient) or an empty member list (group glitch /
      // fully emptied) must never mass-delete — leave meetings untouched.
      log.warn(
        { allReadsOk, members: members.length },
        'calendar-scan: skipping reconciliation (incomplete read) — no deletions',
      );
    }

    // 6. Reclassify already-ingested scheduled meetings against the CURRENT
    //    internal-domain list. The per-sweep upsert only refreshes meetings that
    //    are still on a member's calendar in the scan window; this pass covers the
    //    rest (e.g. after 0005 added the GA onmicrosoft tenant domain, GA-only
    //    meetings outside the window flip to is_internal + link the GA org, and the
    //    onmicrosoft domain is stripped from captured external attendees). Reads
    //    only stored data (no Graph), so it is deterministic and idempotent.
    const reclassified = await reclassifyStoredMeetings(db, ctx, log);

    // 7. Record the last successful scan for the connection panel.
    await recordLastScan(db, now, log);

    const result: CalendarScanResult = {
      skipped: false,
      members: members.length,
      events: eventCount,
      meetings: aggregated.size,
      created,
      updated,
      internal,
      unassigned,
      reaped,
      reclassified,
    };
    log.info(result, 'calendar-scan sweep complete');
    return result;
  };
}

/**
 * Remove calendar-sourced meetings in the scanned window that were NOT seen this
 * sweep — i.e. cancelled in Outlook, or orphaned because the member(s) whose
 * calendar carried them left the access group (a meeting still on ANY current
 * member's calendar keeps the same cross-mailbox dedup key, so it stays). Only
 * touches upcoming, still-`scheduled`, not-yet-dispatched meetings so processed
 * history (bots/transcripts/documents) is preserved; `meeting_clients` links
 * cascade on delete. MUST be called only after a fully-clean sweep.
 */
async function reconcileRemovedMeetings(
  db: ServerClient,
  aggregated: ReadonlyMap<string, AggregatedMeeting>,
  windowStartIso: string,
  windowEndIso: string,
  log: FastifyBaseLogger,
): Promise<number> {
  const { data, error } = await db
    .from('meetings')
    .select('id, calendar_event_id')
    .eq('source', 'calendar')
    .eq('pipeline_status', 'scheduled')
    .eq('bot_dispatched', false)
    .gte('date_time', windowStartIso)
    .lte('date_time', windowEndIso);
  if (error !== null) throw new Error(`calendar-scan: reconcile lookup: ${error.message}`);

  // Stale = has a dedup key that this clean sweep did not observe. Rows without a
  // key are left alone (can't be matched; shouldn't exist for calendar meetings).
  const staleIds = (data ?? [])
    .filter((m) => m.calendar_event_id !== null && !aggregated.has(m.calendar_event_id))
    .map((m) => m.id);
  if (staleIds.length === 0) return 0;

  const del = await db.from('meetings').delete().in('id', staleIds);
  if (del.error !== null) throw new Error(`calendar-scan: reconcile delete: ${del.error.message}`);
  log.info({ reaped: staleIds.length }, 'calendar-scan: removed cancelled/orphaned meetings');
  return staleIds.length;
}

/** Defensively parse a stored `external_attendees` jsonb value into typed rows. */
function parseStoredExternalAttendees(value: Json | null): ExternalAttendee[] {
  if (!Array.isArray(value)) return [];
  const out: ExternalAttendee[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const email = typeof rec.email === 'string' ? rec.email : null;
    const domain = typeof rec.domain === 'string' ? rec.domain : null;
    if (email === null || domain === null) continue;
    out.push({ email, name: typeof rec.name === 'string' ? rec.name : null, domain });
  }
  return out;
}

/**
 * Re-apply the current internal-domain list to every already-ingested,
 * still-`scheduled` calendar meeting (P4.1 follow-on). ADDITIVE reclassification:
 * strips now-internal domains from the captured `external_attendees`, and — when a
 * meeting is left with NO external participants — flips it to `is_internal = true`
 * and homes it to the GA org (add-only link + primary when still unassigned).
 *
 * Never demotes internal → external: the internal-domain list only ever grows, so
 * a meeting that was internal stays internal. In-flight / dispatched / non-calendar
 * meetings are left untouched (same guard as the upsert path).
 */
async function reclassifyStoredMeetings(
  db: ServerClient,
  ctx: ScanContext,
  log: FastifyBaseLogger,
): Promise<number> {
  const { data, error } = await db
    .from('meetings')
    .select('id, client_id, is_internal, external_attendees')
    .eq('source', 'calendar')
    .eq('pipeline_status', 'scheduled')
    .eq('bot_dispatched', false);
  if (error !== null) throw new Error(`calendar-scan: reclassify lookup: ${error.message}`);

  let changed = 0;
  for (const row of data ?? []) {
    const stored = parseStoredExternalAttendees(row.external_attendees);
    const remaining = stored.filter((a) => !ctx.internalDomains.has(a.domain.trim().toLowerCase()));
    const strippedInternal = remaining.length !== stored.length;
    const becameInternal = remaining.length === 0 && !row.is_internal;

    if (!strippedInternal && !becameInternal) continue;

    const patch: MeetingUpdate = {};
    if (strippedInternal) patch.external_attendees = toJson(remaining);
    if (becameInternal) {
      patch.is_internal = true;
      // Home a newly-internal meeting to the GA org only when still unassigned
      // (never overwrite an existing Admin/scan assignment).
      if (ctx.internalOrgId !== null && row.client_id === null) patch.client_id = ctx.internalOrgId;
    }

    const upd = await db.from('meetings').update(patch).eq('id', row.id);
    if (upd.error !== null) throw new Error(`calendar-scan: reclassify update: ${upd.error.message}`);
    if (becameInternal && ctx.internalOrgId !== null) {
      await linkMeetingClients(db, row.id, [ctx.internalOrgId]);
    }
    changed += 1;
  }

  if (changed > 0) log.info({ reclassified: changed }, 'calendar-scan: reclassified stored meetings');
  return changed;
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

/**
 * Load the scan matcher context: the internal-domain set (from
 * `settings.internal_email_domains`), the domain→org map (from `client_domains`
 * joined to non-internal orgs), and the GA internal org id.
 */
async function loadScanContext(db: ServerClient): Promise<ScanContext> {
  const settingRes = await db
    .from('settings')
    .select('value')
    .eq('key', 'internal_email_domains')
    .maybeSingle();
  if (settingRes.error !== null) {
    throw new Error(`calendar-scan: load internal domains: ${settingRes.error.message}`);
  }
  const rawDomains = typeof settingRes.data?.value === 'string' ? settingRes.data.value : null;
  const internalDomains = parseInternalDomains(rawDomains);

  // domain → org, only for real (non-internal) orgs; GA is found by type below and
  // is deliberately NOT registered in client_domains (never matched as a client).
  const domainRes = await db
    .from('client_domains')
    .select('domain, client_id, clients!inner(created_at, type)');
  if (domainRes.error !== null) {
    throw new Error(`calendar-scan: load client_domains: ${domainRes.error.message}`);
  }
  const domainToOrg = new Map<string, OrgDomainEntry>();
  for (const row of domainRes.data ?? []) {
    const org = row.clients as unknown as { created_at: string; type: string } | null;
    if (org === null || org.type === 'internal') continue;
    domainToOrg.set(row.domain.trim().toLowerCase(), {
      clientId: row.client_id,
      domain: row.domain.trim().toLowerCase(),
      createdAt: org.created_at,
    });
  }

  const gaRes = await db
    .from('clients')
    .select('id')
    .eq('type', 'internal')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (gaRes.error !== null) throw new Error(`calendar-scan: load GA org: ${gaRes.error.message}`);

  return { internalDomains, domainToOrg, internalOrgId: gaRes.data?.id ?? null };
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
 * Add `meeting_clients` links for the given orgs (idempotent, add-only: existing
 * links are never removed, per the sticky-link rule).
 */
async function linkMeetingClients(
  db: ServerClient,
  meetingId: string,
  clientIds: readonly string[],
): Promise<void> {
  if (clientIds.length === 0) return;
  const rows = clientIds.map((client_id) => ({ meeting_id: meetingId, client_id }));
  const { error } = await db
    .from('meeting_clients')
    .upsert(rows, { onConflict: 'meeting_id,client_id', ignoreDuplicates: true });
  if (error !== null) throw new Error(`calendar-scan: link meeting_clients: ${error.message}`);
}

/**
 * Insert or refresh the `meetings` row for one aggregated meeting. Returns the
 * outcome for metric counting. See the module header for the non-destructive
 * update rules.
 */
async function upsertMeeting(
  db: ServerClient,
  agg: AggregatedMeeting,
  ctx: ScanContext,
  usersByEmail: ReadonlyMap<string, UserLite>,
): Promise<UpsertOutcome> {
  const event = agg.canonical;
  const startUtc = event.startUtc as string; // non-null: filtered before aggregation
  const resolution = resolveMeetingOrgs(
    {
      attendees: event.attendees.map((a) => ({ email: a.email, name: a.name })),
      organizerEmail: event.organizerEmail,
    },
    { internalDomains: ctx.internalDomains, domainToOrg: ctx.domainToOrg },
  );
  const internalUserIds = resolveInternalUsers(agg, usersByEmail);
  const leadUserId = resolveLead(agg, usersByEmail, internalUserIds);

  // Internal meetings home to the GA org; external meetings to the earliest matched.
  const gaOrgId = resolution.isInternal ? ctx.internalOrgId : null;
  const primaryClientId = resolution.isInternal ? gaOrgId : resolution.primaryClientId;
  const linkIds = resolution.isInternal
    ? gaOrgId !== null
      ? [gaOrgId]
      : []
    : resolution.matchedClientIds;

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
    const insert: MeetingInsert = {
      client_id: primaryClientId,
      title: event.subject,
      date_time: startUtc,
      duration_minutes: computeDuration(startUtc, event.endUtc),
      meeting_lead_user_id: leadUserId,
      attendee_user_ids: internalUserIds,
      calendar_event_id: agg.dedupKey,
      video_link: event.joinUrl,
      is_internal: resolution.isInternal,
      external_attendees: toJson(resolution.externalAttendees),
      pipeline_status: 'scheduled',
      source: 'calendar',
    };
    const inserted = await db.from('meetings').insert(insert).select('id').maybeSingle();
    if (inserted.error !== null) {
      // A concurrent insert may have raced us on the unique dedup key — treat as
      // an update on the next sweep rather than failing the whole scan.
      if (inserted.error.code === '23505') return 'skipped';
      throw new Error(`calendar-scan: insert meeting: ${inserted.error.message}`);
    }
    const newId = inserted.data?.id;
    if (newId !== undefined) await linkMeetingClients(db, newId, linkIds);
    if (resolution.isInternal) return 'created-internal';
    return linkIds.length === 0 ? 'created-unassigned' : 'created';
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
    is_internal: resolution.isInternal,
    external_attendees: toJson(resolution.externalAttendees),
  };
  // Set the primary org only when still unassigned; never overwrite an existing
  // (Admin- or scan-) assigned client.
  if (existing.client_id === null && primaryClientId !== null) {
    patch.client_id = primaryClientId;
  }
  const patched = await db.from('meetings').update(patch).eq('id', existing.id);
  if (patched.error !== null) throw new Error(`calendar-scan: update meeting: ${patched.error.message}`);
  // Add newly-matched links (add-only; previously-created links are sticky).
  await linkMeetingClients(db, existing.id, linkIds);
  return 'updated';
}

/** Upsert the `calendar_last_scan_at` setting for the connection panel. */
async function recordLastScan(db: ServerClient, now: Date, log: FastifyBaseLogger): Promise<void> {
  const { error } = await db
    .from('settings')
    .upsert({ key: 'calendar_last_scan_at', value: now.toISOString() }, { onConflict: 'key' });
  if (error !== null) log.warn({ err: error.message }, 'calendar-scan: could not record last-scan time');
}
