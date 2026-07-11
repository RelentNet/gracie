/**
 * Automation action executors (P8 §4/§8). Given one automation row, build its
 * deterministic output and deliver it — internally by default (in-app notification
 * + allowlist-gated team email), or, for `client_send`, EXTERNALLY through the
 * admin-gated customer-contact exception.
 *
 * Deterministic content (no AI dependency) for cron reliability — same philosophy
 * as daily-sync. Report/digest builders REUSE the daily-sync `gather*` helpers and
 * the same small client-scoped queries the pre-meeting brief uses.
 *
 * SAFETY: `client_send` re-checks the `automations_external_send_enabled` master
 * switch AT RUN TIME (not just at confirm) so an admin flipping it OFF instantly
 * stops all external sends, and it returns the externals actually delivered so the
 * processor can audit them into `automation_runs.external_recipients`.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Database, Json, ServerClient } from '@gracie/db';
import {
  type ActivityDigestParams,
  type AutomationRecipients,
  type AutomationType,
  type ClientReportParams,
  type ClientSendParams,
  type ReminderParams,
} from '@gracie/shared';

import { sendGatedExternalEmail, sendTeamEmail } from './email.js';
import { renderAutomationEmail } from './email-templates/automation.js';
import {
  easternDateString,
  easternDayStartUtc,
  gatherAtRisk,
  gatherTodayMeetings,
  gatherYesterday,
  loadClientNames,
} from '../processors/daily-sync.processor.js';
import { getAppBaseUrl, getAtRiskHealthThreshold } from './notify-config.js';

type AutomationRow = Database['public']['Tables']['automations']['Row'];
type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

/** The master-switch settings key for the customer-contact exception (§2b). */
const EXTERNAL_SEND_SETTING_KEY = 'automations_external_send_enabled';

/** Outcome of running one automation — becomes the `automation_runs` audit row. */
export interface ExecutionOutcome {
  readonly status: 'success' | 'failed' | 'skipped';
  readonly detail: string;
  /** Externals actually emailed under the §2b exception (audit). Empty for internal. */
  readonly externalRecipients: string[];
}

// --- untrusted-jsonb parsing --------------------------------------------------

function asRecord(value: Json | null): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** Parse the recipients jsonb into normalized address/user lists. */
function parseRecipients(value: Json | null): AutomationRecipients {
  const rec = asRecord(value);
  return {
    userIds: asStringArray(rec.userIds),
    emails: asStringArray(rec.emails),
    externalEmails: asStringArray(rec.externalEmails),
  };
}

// --- setting reader -----------------------------------------------------------

/** Read the external-send master switch (JSON string 'true'/'false'; default OFF). */
async function isExternalSendEnabled(db: ServerClient): Promise<boolean> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', EXTERNAL_SEND_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`automation: read ${EXTERNAL_SEND_SETTING_KEY}: ${error.message}`);
  return typeof data?.value === 'string' && data.value.trim().toLowerCase() === 'true';
}

// --- deterministic report builders --------------------------------------------

/** Clamp a one-line summary to a readable length. */
function clampLine(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

/** A per-client summary: health, recent meetings, recent history, open items. */
async function buildClientReport(db: ServerClient, clientId: string): Promise<{ title: string; body: string } | null> {
  const clientRes = await db
    .from('clients')
    .select('id, name, type, cadence, relationship_health, relationship_trend, last_meeting_at')
    .eq('id', clientId)
    .maybeSingle();
  if (clientRes.error !== null) throw new Error(`automation: client_report load: ${clientRes.error.message}`);
  if (clientRes.data === null) return null;
  const client = clientRes.data;

  const lines: string[] = [];
  const health = client.relationship_health !== null ? `${client.relationship_health}/100` : 'n/a';
  lines.push(`Client: ${client.name} · Health: ${health} (${client.relationship_trend ?? 'stable'})`);
  lines.push(`Cadence: ${client.cadence} · Last meeting: ${client.last_meeting_at?.slice(0, 10) ?? 'none recorded'}`);

  const recent = await db
    .from('meetings')
    .select('title, date_time, pipeline_status')
    .eq('client_id', clientId)
    .order('date_time', { ascending: false })
    .limit(5);
  if (recent.error !== null) throw new Error(`automation: client_report meetings: ${recent.error.message}`);
  if ((recent.data ?? []).length > 0) {
    lines.push('');
    lines.push('Recent meetings:');
    for (const m of recent.data ?? []) {
      lines.push(`- ${m.date_time.slice(0, 10)}: ${m.title ?? 'Untitled meeting'} (${m.pipeline_status})`);
    }
  }

  const master = await db
    .from('master_record_entries')
    .select('summary, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(3);
  if (master.error !== null) throw new Error(`automation: client_report master: ${master.error.message}`);
  if ((master.data ?? []).length > 0) {
    lines.push('');
    lines.push('Recent history:');
    for (const row of master.data ?? []) {
      lines.push(`- ${row.created_at.slice(0, 10)}: ${clampLine(row.summary)}`);
    }
  }

  const tasks = await db
    .from('tasks')
    .select('description, due_date, priority_flag')
    .eq('client_id', clientId)
    .neq('status', 'complete')
    .eq('archived', false)
    .order('priority_flag', { ascending: false })
    .limit(10);
  if (tasks.error !== null) throw new Error(`automation: client_report tasks: ${tasks.error.message}`);
  if ((tasks.data ?? []).length > 0) {
    lines.push('');
    lines.push('Open items:');
    for (const t of tasks.data ?? []) {
      const due = t.due_date !== null ? ` (due ${t.due_date})` : '';
      const flag = t.priority_flag ? ' [priority]' : '';
      lines.push(`- ${clampLine(t.description)}${due}${flag}`);
    }
  }

  return { title: `Client report: ${client.name}`, body: lines.join('\n') };
}

/** A cross-client rollup: roster by cadence + the at-risk list. */
async function buildPortfolioDigest(db: ServerClient): Promise<{ title: string; body: string }> {
  const clientsRes = await db
    .from('clients')
    .select('name, cadence, relationship_health, relationship_trend')
    .eq('type', 'client')
    .order('relationship_health', { ascending: true, nullsFirst: false });
  if (clientsRes.error !== null) throw new Error(`automation: portfolio clients: ${clientsRes.error.message}`);
  const clients = clientsRes.data ?? [];

  const threshold = await getAtRiskHealthThreshold(db);
  const atRisk = await gatherAtRisk(db, threshold);

  const lines: string[] = [];
  lines.push(`Portfolio: ${clients.length} active client(s).`);
  if (atRisk.length > 0) {
    lines.push('');
    lines.push(`At-risk clients (health ≤ ${threshold} or declining):`);
    for (const c of atRisk) {
      const h = c.health !== null ? `${c.health}/100` : 'n/a';
      lines.push(`- ${c.name}: ${h} (${c.trend ?? 'stable'})`);
    }
  } else {
    lines.push('');
    lines.push('No at-risk clients right now.');
  }

  lines.push('');
  lines.push('Roster (lowest health first):');
  for (const c of clients.slice(0, 25)) {
    const h = c.relationship_health !== null ? `${c.relationship_health}/100` : 'n/a';
    lines.push(`- ${c.name}: ${h} · ${c.cadence} · ${c.relationship_trend ?? 'stable'}`);
  }

  return { title: 'Portfolio digest', body: lines.join('\n') };
}

/** A yesterday/today activity rollup — reuses the daily-sync gather helpers. */
async function buildActivityDigest(
  db: ServerClient,
  now: Date,
  window: ActivityDigestParams['window'],
): Promise<{ title: string; body: string }> {
  const todayEt = easternDateString(now);
  const todayStart = easternDayStartUtc(todayEt).toISOString();
  const tomorrowEt = easternDateString(new Date(now.getTime() + 86_400_000));
  const tomorrowStart = easternDayStartUtc(tomorrowEt).toISOString();
  const yesterdayEt = easternDateString(new Date(now.getTime() - 86_400_000));
  const yesterdayStart = easternDayStartUtc(yesterdayEt).toISOString();

  const wantYesterday = window === 'yesterday' || window === 'both' || window === undefined;
  const wantToday = window === 'today' || window === 'both' || window === undefined;

  const lines: string[] = [];
  if (wantYesterday) {
    const y = await gatherYesterday(db, yesterdayStart, todayStart);
    lines.push('Yesterday:');
    lines.push(`- Meetings processed: ${y.meetingsProcessed}`);
    lines.push(`- Documents generated: ${y.documentsGenerated}`);
    lines.push(`- Tasks created: ${y.tasksCreated} · completed: ${y.tasksCompleted}`);
  }
  if (wantToday) {
    const rows = await gatherTodayMeetings(db, todayStart, tomorrowStart);
    const clientIds = rows.map((m) => m.client_id).filter((id): id is string => id !== null);
    const names = await loadClientNames(db, clientIds);
    if (lines.length > 0) lines.push('');
    lines.push(`Today — ${rows.length} meeting(s):`);
    for (const m of rows) {
      const client = m.client_id !== null ? names.get(m.client_id) ?? 'Unassigned' : 'Internal/none';
      lines.push(`- ${m.date_time.slice(11, 16)} · ${m.title ?? 'Untitled meeting'} · ${client}`);
    }
    if (rows.length === 0) lines.push('- No meetings scheduled.');
  }

  return { title: 'Activity digest', body: lines.join('\n') };
}

// --- delivery -----------------------------------------------------------------

interface ResolvedUser {
  readonly id: string;
  readonly email: string;
}

/** Resolve internal recipient user rows (active users only) for the given ids. */
async function resolveUsers(db: ServerClient, userIds: readonly string[]): Promise<ResolvedUser[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await db
    .from('users')
    .select('id, email, deactivated_at')
    .in('id', [...userIds])
    .is('deactivated_at', null);
  if (error !== null) throw new Error(`automation: resolve users: ${error.message}`);
  return (data ?? []).map((u) => ({ id: u.id, email: u.email }));
}

/** Write one in-app notification per user (type 'automation'), best-effort. */
async function notifyUsers(
  db: ServerClient,
  userIds: readonly string[],
  title: string,
  body: string,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const trimmed = body.length > 900 ? `${body.slice(0, 899)}…` : body;
  const rows: NotificationInsert[] = userIds.map((userId) => ({
    user_id: userId,
    type: 'automation',
    title,
    body: trimmed,
    link: '/automations',
  }));
  const { error } = await db.from('notifications').insert(rows);
  if (error !== null) throw new Error(`automation: notify: ${error.message}`);
  return userIds.length;
}

/**
 * Deliver a report/digest/reminder INTERNALLY: an in-app notification to each
 * internal user + one allowlist-gated team email. Falls back to the OWNER when no
 * recipients are configured, so a report never runs into the void.
 */
async function deliverInternal(
  db: ServerClient,
  log: FastifyBaseLogger,
  automation: AutomationRow,
  recipients: AutomationRecipients,
  content: { title: string; body: string },
): Promise<string> {
  const userIds = recipients.userIds ?? [];
  const targetUserIds = userIds.length > 0 ? userIds : [automation.owner_user_id];
  const users = await resolveUsers(db, targetUserIds);

  const notified = await notifyUsers(db, users.map((u) => u.id), content.title, content.body);

  const emails = [...new Set([...users.map((u) => u.email), ...(recipients.emails ?? [])])].filter(
    (e) => e.trim() !== '',
  );
  let emailed = 0;
  if (emails.length > 0) {
    const rendered = renderAutomationEmail({
      title: content.title,
      body: content.body,
      link: '/automations',
      appUrl: getAppBaseUrl(),
      internal: true,
    });
    const res = await sendTeamEmail(
      { to: emails, subject: rendered.subject, html: rendered.html, text: rendered.text },
      { logger: log, db },
    );
    emailed = res.delivered.length;
  }
  return `${notified} in-app, ${emailed} email`;
}

// --- executor dispatch --------------------------------------------------------

interface ExecutorContext {
  readonly db: ServerClient;
  readonly log: FastifyBaseLogger;
  readonly now: Date;
  readonly automation: AutomationRow;
}

/**
 * Run one automation to completion and return its audit outcome. Never throws for
 * an expected condition (missing client, external send disabled) — those become a
 * `failed`/`skipped` outcome. Only truly unexpected errors propagate (BullMQ retry).
 */
export async function runAutomation(ctx: ExecutorContext): Promise<ExecutionOutcome> {
  const { db, log, now, automation } = ctx;
  const type = automation.type as AutomationType;
  const params = asRecord(automation.params);
  const recipients = parseRecipients(automation.recipients);

  switch (type) {
    case 'client_report': {
      const p = params as unknown as ClientReportParams;
      if (typeof p.clientId !== 'string' || p.clientId === '') {
        return { status: 'failed', detail: 'client_report: missing clientId', externalRecipients: [] };
      }
      const content = await buildClientReport(db, p.clientId);
      if (content === null) {
        return { status: 'skipped', detail: 'client_report: client no longer exists', externalRecipients: [] };
      }
      const detail = await deliverInternal(db, log, automation, recipients, content);
      return { status: 'success', detail: `client_report → ${detail}`, externalRecipients: [] };
    }

    case 'portfolio_digest': {
      const content = await buildPortfolioDigest(db);
      const detail = await deliverInternal(db, log, automation, recipients, content);
      return { status: 'success', detail: `portfolio_digest → ${detail}`, externalRecipients: [] };
    }

    case 'activity_digest': {
      const p = params as unknown as ActivityDigestParams;
      const content = await buildActivityDigest(db, now, p.window);
      const detail = await deliverInternal(db, log, automation, recipients, content);
      return { status: 'success', detail: `activity_digest → ${detail}`, externalRecipients: [] };
    }

    case 'reminder': {
      const p = params as unknown as ReminderParams;
      const message = typeof p.message === 'string' ? p.message.trim() : '';
      if (message === '') {
        return { status: 'failed', detail: 'reminder: empty message', externalRecipients: [] };
      }
      const detail = await deliverInternal(db, log, automation, recipients, {
        title: automation.title,
        body: message,
      });
      return { status: 'success', detail: `reminder → ${detail}`, externalRecipients: [] };
    }

    case 'client_send':
      return runClientSend(ctx, params as unknown as ClientSendParams, recipients);

    default:
      return { status: 'failed', detail: `unknown automation type: ${String(type)}`, externalRecipients: [] };
  }
}

/**
 * The gated customer-contact exception. Re-checks the master switch AT RUN TIME so
 * turning it OFF instantly stops external delivery, then sends through the single
 * gated choke-point and returns the externals actually delivered (for audit).
 */
async function runClientSend(
  ctx: ExecutorContext,
  params: ClientSendParams,
  recipients: AutomationRecipients,
): Promise<ExecutionOutcome> {
  const { db, log, automation } = ctx;
  const externalEmails = recipients.externalEmails ?? [];
  const subject = typeof params.subject === 'string' ? params.subject.trim() : '';
  const body = typeof params.body === 'string' ? params.body.trim() : '';

  if (subject === '' || body === '') {
    return { status: 'failed', detail: 'client_send: missing subject/body', externalRecipients: [] };
  }
  if (externalEmails.length === 0) {
    return { status: 'failed', detail: 'client_send: no external recipients', externalRecipients: [] };
  }

  // Live kill: the master switch must be ON at run time, and the automation must
  // still be flagged external. Either false → skip WITHOUT sending anything.
  if (!automation.has_external_recipient) {
    return { status: 'skipped', detail: 'client_send: not flagged external — skipped', externalRecipients: [] };
  }
  if (!(await isExternalSendEnabled(db))) {
    return {
      status: 'skipped',
      detail: 'client_send: external-send master switch is OFF — skipped',
      externalRecipients: [],
    };
  }

  // Internal recipients (staff CC) go through the same send but obey the allowlist.
  const internalUsers = await resolveUsers(db, recipients.userIds ?? []);
  const internalEmails = [...new Set([...internalUsers.map((u) => u.email), ...(recipients.emails ?? [])])].filter(
    (e) => e.trim() !== '',
  );

  const rendered = renderAutomationEmail({
    title: subject,
    body,
    appUrl: getAppBaseUrl(),
    internal: false,
  });
  const res = await sendGatedExternalEmail(
    {
      to: [...externalEmails, ...internalEmails],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      approvedExternalRecipients: externalEmails,
    },
    { logger: log, db },
  );

  // Tell internal staff (in-app) that a client message went out under their name.
  await notifyUsers(
    db,
    internalUsers.map((u) => u.id),
    `Client message sent: ${subject}`,
    `Delivered to ${res.externalDelivered.join(', ') || '(no external recipients accepted)'}`,
  );

  if (res.externalDelivered.length === 0) {
    return {
      status: 'failed',
      detail: 'client_send: no external recipient accepted (check addresses)',
      externalRecipients: [],
    };
  }
  return {
    status: 'success',
    detail: `client_send → ${res.externalDelivered.length} external, ${res.delivered.length - res.externalDelivered.length} internal`,
    externalRecipients: res.externalDelivered,
  };
}
