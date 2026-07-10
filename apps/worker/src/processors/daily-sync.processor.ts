/**
 * Daily-sync processor (P7 §6/§7). The gated morning sweep:
 *
 *   1. gate on the configured ET send hour (default 6 AM) + `daily_sync_enabled`
 *      (a `source='manual'` run bypasses both),
 *   2. gather yesterday's activity, today's schedule, and at-risk clients,
 *   3. generate that day's pre-meeting briefs (§7) for external client meetings,
 *   4. write/refresh the `daily_syncs` row (structured `content` jsonb),
 *   5. run the KB-expiry check (folded in — admin email + in-app notification),
 *   6. deliver ONE bundled email per active staffer (allowlist-gated) and stamp
 *      `delivered_at` — idempotent per `sync_date` so a later sweep no-ops.
 *
 * Deterministic content (no AI dependency) for cron reliability. All email goes
 * through the allowlist-gated `sendTeamEmail`/`emailAdminsForAlert` choke-point.
 * Single-worker/concurrency-1 assumption keeps the "generate → send → stamp"
 * sequence race-free; per-recipient sends are best-effort so a transient Resend
 * failure never triggers a duplicate-email storm on BullMQ retry.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, Json, ServerClient } from '@gracie/db';
import type {
  DailySyncAtRiskClient,
  DailySyncBrief,
  DailySyncContent,
  DailySyncJobPayload,
  DailySyncMeeting,
  DailySyncYesterday,
} from '@gracie/shared';

import { buildBriefContent, type BriefMeeting } from '../lib/brief.js';
import { renderDailySyncEmail } from '../lib/email-templates/daily-sync.js';
import { emailAdminsForAlert, sendTeamEmail } from '../lib/email.js';
import {
  getAppBaseUrl,
  getAtRiskHealthThreshold,
  getDailySyncConfig,
  getKbExpiryWarningDays,
} from '../lib/notify-config.js';

type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

const ET = 'America/New_York';

/** Outcome of one daily-sync run (visible in Bull Board). */
export interface DailySyncResult {
  readonly skipped: boolean;
  readonly reason?: string;
  readonly syncDate: string;
  readonly meetings: number;
  readonly briefs: number;
  /** Active staff targeted for the email. */
  readonly recipients: number;
  /** Emails actually delivered (allowlisted recipients that Resend accepted). */
  readonly delivered: number;
  readonly kbExpiringAlerts: number;
}

function skip(reason: string, syncDate: string): DailySyncResult {
  return { skipped: true, reason, syncDate, meetings: 0, briefs: 0, recipients: 0, delivered: 0, kbExpiringAlerts: 0 };
}

// --- Eastern-time helpers (DST-safe via Intl; no date library) ----------------

/** The ET calendar date (YYYY-MM-DD) for an instant. */
function easternDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Milliseconds to add to an ET wall-clock to get the UTC instant (i.e. the offset). */
function easternOffsetMs(at: Date): number {
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const et = new Date(at.toLocaleString('en-US', { timeZone: ET }));
  return utc.getTime() - et.getTime();
}

/** The UTC instant at 00:00 ET on the given ET date (YYYY-MM-DD). */
function easternDayStartUtc(etDate: string): Date {
  const offset = easternOffsetMs(new Date(`${etDate}T12:00:00Z`));
  return new Date(Date.parse(`${etDate}T00:00:00Z`) + offset);
}

/** The ET wall-clock hour (0–23) for an instant. */
function easternHour(d: Date): number {
  const raw =
    new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false })
      .formatToParts(d)
      .find((p) => p.type === 'hour')?.value ?? '0';
  return Number(raw) % 24;
}

/** Long ET date label (e.g. "Friday, July 10, 2026") for an ET date string. */
function easternDateLabel(etDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(easternDayStartUtc(etDate));
}

// --- User loading -------------------------------------------------------------

interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly deactivated: boolean;
}

/** Load all users once (name map for rendering + active-staff recipient list). */
async function loadUsers(db: ServerClient): Promise<UserRow[]> {
  const { data, error } = await db.from('users').select('id, name, email, deactivated_at');
  if (error !== null) throw new Error(`daily-sync: load users: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    deactivated: u.deactivated_at !== null,
  }));
}

// --- Gather -------------------------------------------------------------------

/** Count rows for a bounded query (head-only, exact count). */
async function countExact(
  build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
): Promise<number> {
  const { count, error } = await build();
  if (error !== null) throw new Error(`daily-sync: count ${label}: ${error.message}`);
  return count ?? 0;
}

/** Yesterday's activity rollup over the [start, end) UTC window. */
async function gatherYesterday(db: ServerClient, startIso: string, endIso: string): Promise<DailySyncYesterday> {
  const meetingsProcessed = await countExact(
    () =>
      db
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .gte('pipeline_completed_at', startIso)
        .lt('pipeline_completed_at', endIso),
    'meetings processed',
  );
  const documentsGenerated = await countExact(
    () =>
      db
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('source_badge', 'meeting')
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    'documents',
  );
  const tasksCreated = await countExact(
    () =>
      db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    'tasks created',
  );
  const tasksCompleted = await countExact(
    () =>
      db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'complete')
        .gte('updated_at', startIso)
        .lt('updated_at', endIso),
    'tasks completed',
  );
  return { meetingsProcessed, documentsGenerated, tasksCreated, tasksCompleted };
}

/** Raw today's-meeting row used before enrichment. */
interface TodayMeetingRow {
  readonly id: string;
  readonly title: string | null;
  readonly date_time: string;
  readonly client_id: string | null;
  readonly is_internal: boolean;
  readonly meeting_lead_user_id: string | null;
  readonly attendee_user_ids: string[];
  readonly external_attendees: Json;
}

/** Today's scheduled meetings within the [start, end) UTC window, ordered by time. */
async function gatherTodayMeetings(db: ServerClient, startIso: string, endIso: string): Promise<TodayMeetingRow[]> {
  const { data, error } = await db
    .from('meetings')
    .select('id, title, date_time, client_id, is_internal, meeting_lead_user_id, attendee_user_ids, external_attendees')
    .gte('date_time', startIso)
    .lt('date_time', endIso)
    .order('date_time', { ascending: true });
  if (error !== null) throw new Error(`daily-sync: today meetings: ${error.message}`);
  return data ?? [];
}

/** At-risk clients: non-internal, low OR declining relationship health. */
async function gatherAtRisk(db: ServerClient, threshold: number): Promise<DailySyncAtRiskClient[]> {
  const { data, error } = await db
    .from('clients')
    .select('id, name, relationship_health, relationship_trend, type')
    .neq('type', 'internal')
    .or(`relationship_health.lte.${threshold},relationship_trend.eq.declining`)
    .order('relationship_health', { ascending: true, nullsFirst: false })
    .limit(12);
  if (error !== null) throw new Error(`daily-sync: at-risk clients: ${error.message}`);
  return (data ?? []).map((c) => ({
    clientId: c.id,
    name: c.name,
    health: c.relationship_health,
    trend: c.relationship_trend,
  }));
}

/** Fetch client names for a set of ids (for meeting + brief rendering). */
async function loadClientNames(db: ServerClient, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from('clients').select('id, name').in('id', unique);
  if (error !== null) throw new Error(`daily-sync: client names: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

/** Fetch client health for a set of ids (for briefs). */
async function loadClientHealth(db: ServerClient, ids: readonly string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from('clients').select('id, relationship_health').in('id', unique);
  if (error !== null) throw new Error(`daily-sync: client health: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, c.relationship_health]));
}

// --- Briefs -------------------------------------------------------------------

/** Insert or refresh the `pre_meeting_briefs` row for a meeting (idempotent per meeting). */
async function upsertBrief(db: ServerClient, meetingId: string, content: string, nowIso: string): Promise<void> {
  const existing = await db.from('pre_meeting_briefs').select('id').eq('meeting_id', meetingId).maybeSingle();
  if (existing.error !== null) throw new Error(`daily-sync: brief lookup: ${existing.error.message}`);
  if (existing.data !== null) {
    const upd = await db
      .from('pre_meeting_briefs')
      .update({ content, generated_at: nowIso })
      .eq('id', existing.data.id);
    if (upd.error !== null) throw new Error(`daily-sync: brief update: ${upd.error.message}`);
    return;
  }
  const ins = await db
    .from('pre_meeting_briefs')
    .insert({ meeting_id: meetingId, content, generated_at: nowIso });
  if (ins.error !== null) throw new Error(`daily-sync: brief insert: ${ins.error.message}`);
}

/** Stamp delivery on the briefs bundled into today's email. */
async function markBriefsDelivered(
  db: ServerClient,
  meetingIds: readonly string[],
  userIds: readonly string[],
  nowIso: string,
): Promise<void> {
  if (meetingIds.length === 0) return;
  const upd = await db
    .from('pre_meeting_briefs')
    .update({ delivered_at: nowIso, delivered_to_user_ids: [...userIds] })
    .in('meeting_id', [...meetingIds]);
  if (upd.error !== null) throw new Error(`daily-sync: mark briefs delivered: ${upd.error.message}`);
}

// --- daily_syncs persistence --------------------------------------------------

/** Insert or refresh the `daily_syncs` row for `syncDate`; returns its id + prior delivered_at. */
async function upsertDailySync(
  db: ServerClient,
  syncDate: string,
  content: DailySyncContent,
  meetingIds: readonly string[],
  nowIso: string,
): Promise<{ id: string; alreadyDeliveredAt: string | null }> {
  const existing = await db
    .from('daily_syncs')
    .select('id, delivered_at')
    .eq('sync_date', syncDate)
    .maybeSingle();
  if (existing.error !== null) throw new Error(`daily-sync: lookup: ${existing.error.message}`);

  const contentJson = content as unknown as Json;
  if (existing.data !== null) {
    const upd = await db
      .from('daily_syncs')
      .update({ content: contentJson, generated_at: nowIso, meeting_ids_included: [...meetingIds] })
      .eq('id', existing.data.id);
    if (upd.error !== null) throw new Error(`daily-sync: update: ${upd.error.message}`);
    return { id: existing.data.id, alreadyDeliveredAt: existing.data.delivered_at };
  }

  const ins = await db
    .from('daily_syncs')
    .insert({ sync_date: syncDate, content: contentJson, generated_at: nowIso, meeting_ids_included: [...meetingIds] })
    .select('id')
    .single();
  if (ins.error !== null) throw new Error(`daily-sync: insert: ${ins.error.message}`);
  return { id: ins.data.id, alreadyDeliveredAt: null };
}

// --- KB expiry check (folded in) ---------------------------------------------

/** Parse a JSON-string-array setting value into a set of ids. */
function parseIdSet(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    // ignore malformed marker — treat as empty (will re-alert; harmless once).
  }
  return new Set();
}

/** Active admin user ids (in-app fallback recipients when a doc has no uploader). */
async function loadAdminUserIds(db: ServerClient): Promise<string[]> {
  const { data, error } = await db.from('users').select('id').eq('role', 'admin').is('deactivated_at', null);
  if (error !== null) throw new Error(`daily-sync: load admins: ${error.message}`);
  return (data ?? []).map((u) => u.id);
}

/**
 * Alert on KB documents nearing expiry (P7 §5). In-app to the uploader (else
 * admins); email to admins. Idempotent via a `settings` marker of already-alerted
 * doc ids so a doc is flagged once, not every morning.
 */
async function runKbExpiryCheck(db: ServerClient, log: FastifyBaseLogger): Promise<number> {
  const warningDays = await getKbExpiryWarningDays(db);
  const cutoff = new Date(Date.now() + warningDays * 86_400_000).toISOString().slice(0, 10);

  const docs = await db
    .from('knowledge_base_documents')
    .select('id, title, expiration_date, uploaded_by_user_id')
    .not('expiration_date', 'is', null)
    .lte('expiration_date', cutoff);
  if (docs.error !== null) throw new Error(`daily-sync: kb expiry scan: ${docs.error.message}`);

  const markerRes = await db.from('settings').select('value').eq('key', 'kb_expiring_alerted_doc_ids').maybeSingle();
  if (markerRes.error !== null) throw new Error(`daily-sync: kb marker read: ${markerRes.error.message}`);
  const alerted = parseIdSet(typeof markerRes.data?.value === 'string' ? markerRes.data.value : null);

  const fresh = (docs.data ?? []).filter((d) => !alerted.has(d.id));
  if (fresh.length === 0) return 0;

  const adminIds = await loadAdminUserIds(db);
  for (const doc of fresh) {
    const title = `Knowledge base doc expiring: ${doc.title}`;
    const body = `“${doc.title}” expires ${doc.expiration_date}. Review or replace it in the Knowledge Base.`;
    const recipients = doc.uploaded_by_user_id !== null ? [doc.uploaded_by_user_id] : adminIds;
    if (recipients.length > 0) {
      const rows: NotificationInsert[] = recipients.map((userId) => ({
        user_id: userId,
        type: 'kb_expiring',
        title,
        body,
        link: '/knowledge-base',
      }));
      const ins = await db.from('notifications').insert(rows);
      if (ins.error !== null) throw new Error(`daily-sync: kb notify: ${ins.error.message}`);
    }
    await emailAdminsForAlert(
      { type: 'kb_expiring', title, body, link: '/knowledge-base' },
      { logger: log, db },
    );
    alerted.add(doc.id);
  }

  const write = await db
    .from('settings')
    .upsert({ key: 'kb_expiring_alerted_doc_ids', value: JSON.stringify([...alerted]) }, { onConflict: 'key' });
  if (write.error !== null) log.warn({ err: write.error.message }, 'daily-sync: could not persist kb alert marker');

  log.info({ alerted: fresh.length }, 'daily-sync: kb-expiry alerts sent');
  return fresh.length;
}

// --- Processor ----------------------------------------------------------------

/** Build the daily-sync processor, logging through the worker's Fastify logger. */
export function createDailySyncProcessor(logger: FastifyBaseLogger): Processor<DailySyncJobPayload, DailySyncResult> {
  return async (job: Job<DailySyncJobPayload>): Promise<DailySyncResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const now = new Date();
    const nowIso = now.toISOString();
    const isManual = job.data.source === 'manual';
    const todayEt = easternDateString(now);

    // 1. Gate (scheduled runs only).
    const config = await getDailySyncConfig(db);
    if (!isManual) {
      if (!config.enabled) {
        log.info('daily-sync: disabled — skipping');
        return skip('disabled', todayEt);
      }
      if (easternHour(now) !== config.hourEt) {
        return skip('outside_send_hour', todayEt);
      }
    }

    // Idempotency: has today's sync already been delivered? (manual re-sends.)
    const priorRow = await db
      .from('daily_syncs')
      .select('delivered_at')
      .eq('sync_date', todayEt)
      .maybeSingle();
    if (priorRow.error !== null) throw new Error(`daily-sync: prior lookup: ${priorRow.error.message}`);
    if (!isManual && priorRow.data?.delivered_at != null) {
      log.info({ syncDate: todayEt }, 'daily-sync: already delivered today — skipping');
      return skip('already_delivered', todayEt);
    }

    // 2. Window boundaries (ET days → UTC instants).
    const todayStart = easternDayStartUtc(todayEt).toISOString();
    const tomorrowEt = easternDateString(new Date(now.getTime() + 86_400_000));
    const tomorrowStart = easternDayStartUtc(tomorrowEt).toISOString();
    const yesterdayEt = easternDateString(new Date(now.getTime() - 86_400_000));
    const yesterdayStart = easternDayStartUtc(yesterdayEt).toISOString();

    // 3. Gather.
    const users = await loadUsers(db);
    const usersById = new Map(users.map((u) => [u.id, u.name]));
    const activeStaff = users.filter((u) => !u.deactivated && u.email.trim() !== '');

    const yesterday = await gatherYesterday(db, yesterdayStart, todayStart);
    const todayRows = await gatherTodayMeetings(db, todayStart, tomorrowStart);
    const threshold = await getAtRiskHealthThreshold(db);
    const atRiskClients = await gatherAtRisk(db, threshold);

    const clientIds = todayRows.map((m) => m.client_id).filter((id): id is string => id !== null);
    const clientNames = await loadClientNames(db, clientIds);

    // 4. Briefs (external client meetings only — the ones a brief is meaningful for).
    const briefs: DailySyncBrief[] = [];
    const briefMeetingIds = new Set<string>();
    if (config.briefsEnabled) {
      const briefable = todayRows.filter((m) => !m.is_internal && m.client_id !== null);
      const healthByClient = await loadClientHealth(
        db,
        briefable.map((m) => m.client_id as string),
      );
      for (const m of briefable) {
        const clientId = m.client_id as string;
        const clientName = clientNames.get(clientId) ?? 'Unassigned client';
        const briefMeeting: BriefMeeting = {
          id: m.id,
          title: m.title,
          date_time: m.date_time,
          client_id: clientId,
          meeting_lead_user_id: m.meeting_lead_user_id,
          attendee_user_ids: m.attendee_user_ids,
          external_attendees: m.external_attendees,
        };
        const content = await buildBriefContent(db, briefMeeting, {
          clientName,
          health: healthByClient.get(clientId) ?? null,
          usersById,
        });
        await upsertBrief(db, m.id, content, nowIso);
        briefs.push({ meetingId: m.id, title: m.title ?? 'Untitled meeting', clientName, content });
        briefMeetingIds.add(m.id);
      }
    }

    // 5. Build structured content + persist the daily_syncs row.
    const todayMeetings: DailySyncMeeting[] = todayRows.map((m) => ({
      meetingId: m.id,
      title: m.title ?? 'Untitled meeting',
      timeIso: m.date_time,
      clientId: m.client_id,
      clientName: m.client_id !== null ? clientNames.get(m.client_id) ?? null : null,
      isInternal: m.is_internal,
      leadName: m.meeting_lead_user_id !== null ? usersById.get(m.meeting_lead_user_id) ?? null : null,
      hasBrief: briefMeetingIds.has(m.id),
    }));

    const content: DailySyncContent = {
      version: 1,
      generatedAtIso: nowIso,
      yesterday,
      todayMeetings,
      atRiskClients,
      briefs,
    };
    const { alreadyDeliveredAt } = await upsertDailySync(
      db,
      todayEt,
      content,
      todayRows.map((m) => m.id),
      nowIso,
    );

    // 6. KB-expiry check (folded into the morning run).
    const kbExpiringAlerts = await runKbExpiryCheck(db, log);

    // 7. Deliver — one bundled email per active staffer (allowlist-gated inside
    //    sendTeamEmail). Best-effort per recipient: a transient failure is logged,
    //    not thrown, so BullMQ never retries into a duplicate-email storm.
    const shouldDeliver = isManual || alreadyDeliveredAt === null;
    let delivered = 0;
    if (shouldDeliver && activeStaff.length > 0) {
      const syncDateLabel = easternDateLabel(todayEt);
      const appUrl = getAppBaseUrl();
      for (const staff of activeStaff) {
        try {
          const email = renderDailySyncEmail({
            recipientName: staff.name,
            syncDateLabel,
            content,
            appUrl,
          });
          const res = await sendTeamEmail(
            { to: [staff.email], subject: email.subject, html: email.html, text: email.text },
            { logger: log, db },
          );
          delivered += res.delivered.length;
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), recipient: staff.email },
            'daily-sync: recipient send failed (non-fatal)',
          );
        }
      }
      await db.from('daily_syncs').update({ delivered_at: nowIso }).eq('sync_date', todayEt);
      await markBriefsDelivered(db, [...briefMeetingIds], activeStaff.map((u) => u.id), nowIso);
    }

    const result: DailySyncResult = {
      skipped: false,
      syncDate: todayEt,
      meetings: todayMeetings.length,
      briefs: briefs.length,
      recipients: activeStaff.length,
      delivered,
      kbExpiringAlerts,
    };
    log.info(result, 'daily-sync run complete');
    return result;
  };
}
