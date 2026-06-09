/**
 * Phase 1B seed script — populates self-hosted Supabase from the app's mock
 * datasets so the UI runs on real persisted data.
 *
 * Mock IDs (e.g. "usr_allie", "cli_cms") are mapped to DETERMINISTIC UUIDs via
 * uuid v5 so foreign-key relationships stay consistent and re-runs are stable.
 *
 * Run from repo root:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm dlx tsx packages/db/seed/seed.ts
 *
 * Idempotent: upserts by id.
 */
import { createHash } from 'node:crypto';

import { getServerClient } from '../src/index.js';
import {
  MOCK_USERS,
  MOCK_CLIENTS,
  MOCK_TASKS,
  MOCK_TASK_NOTES,
  MOCK_CLIENT_NOTES,
  MOCK_MASTER_RECORD,
  MOCK_MEETINGS,
} from '../../../apps/web/lib/mock/index.js';

/** Deterministic UUID v5-ish from a stable string (namespaced). */
function toUuid(key: string): string {
  const h = createHash('sha1').update('gracie:' + key).digest('hex');
  // Format as a UUID and force version 5 + RFC4122 variant bits.
  const u =
    h.slice(0, 8) +
    '-' +
    h.slice(8, 12) +
    '-5' +
    h.slice(13, 16) +
    '-' +
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) +
    h.slice(17, 20) +
    '-' +
    h.slice(20, 32);
  return u;
}

function uid(id: string | null): string | null {
  return id === null ? null : toUuid(id);
}

async function main(): Promise<void> {
  // 1. users
  const users = MOCK_USERS.map((u) => ({
    id: toUuid(u.id),
    logto_id: u.logtoId,
    email: u.email,
    name: u.name,
    initials: u.initials,
    role: u.role,
    calendar_connected: u.isCalendarConnected,
    last_active_at: u.lastActiveAt,
  }));
  await upsert('users', users);

  // 2. clients
  const clients = MOCK_CLIENTS.map((c) => ({
    id: toUuid(c.id),
    name: c.name,
    initials: c.initials,
    contract_number: c.contractNumber,
    primary_contact: c.primaryContact,
    primary_contact_email: c.primaryContactEmail,
    cadence: c.cadence,
    fee_tier: c.feeTier,
    contract_value: c.contractValue,
    billing_cadence: c.billingCadence,
    description: c.description,
    relationship_health: c.relationshipHealth,
    relationship_trend: c.relationshipTrend,
    last_meeting_at: c.lastMeetingAt,
    drive_folder_url: c.driveFolderUrl,
  }));
  await upsert('clients', clients);

  // 3. meetings (FK: client, users)
  const meetings = MOCK_MEETINGS.map((m) => ({
    id: toUuid(m.id),
    client_id: uid(m.clientId),
    title: m.title,
    date_time: m.dateTime,
    duration_minutes: m.durationMinutes,
    meeting_type: m.meetingType,
    meeting_lead_user_id: uid(m.meetingLeadUserId),
    attendee_user_ids: m.attendeeUserIds.map(toUuid),
    calendar_event_id: m.calendarEventId,
    video_link: m.videoLink,
    bot_dispatched: m.isBotDispatched,
    bot_job_id: m.botJobId,
    transcript_received: m.isTranscriptReceived,
    pipeline_status: m.pipelineStatus,
    pipeline_started_at: m.pipelineStartedAt,
    pipeline_completed_at: m.pipelineCompletedAt,
    has_open_items: m.hasOpenItems,
    source: m.source,
  }));
  await upsert('meetings', meetings);

  // 4. tasks (FK: client, meeting, user)
  const tasks = MOCK_TASKS.map((t) => ({
    id: toUuid(t.id),
    client_id: toUuid(t.clientId),
    source_meeting_id: uid(t.sourceMeetingId),
    source_document_id: null,
    description: t.description,
    owner_user_id: uid(t.ownerUserId),
    due_date: t.dueDate,
    status: t.status,
    priority_flag: t.hasPriorityFlag,
    archived: t.isArchived,
  }));
  await upsert('tasks', tasks);

  // 5. task_notes
  const taskNotes = MOCK_TASK_NOTES.map((n) => ({
    id: toUuid(n.id),
    task_id: toUuid(n.taskId),
    author_user_id: uid(n.authorUserId),
    content: n.content,
    created_at: n.createdAt,
  }));
  await upsert('task_notes', taskNotes);

  // 6. client_notes
  const clientNotes = MOCK_CLIENT_NOTES.map((n) => ({
    id: toUuid(n.id),
    client_id: toUuid(n.clientId),
    author_user_id: uid(n.authorUserId),
    content: n.content,
  }));
  await upsert('client_notes', clientNotes);

  // 7. master_record_entries
  const master = MOCK_MASTER_RECORD.map((e) => ({
    id: toUuid(e.id),
    client_id: toUuid(e.clientId),
    meeting_id: uid(e.meetingId),
    summary: e.summary,
    created_at: e.createdAt,
  }));
  await upsert('master_record_entries', master);

  console.log('\nSEED COMPLETE');
}

async function upsert(table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  const db = getServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db.from(table) as any).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`seeded ${table}: ${rows.length} rows`);
}

main().catch((e: unknown) => {
  console.error('SEED FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
