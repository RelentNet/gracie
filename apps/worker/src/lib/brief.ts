/**
 * Pre-meeting brief builder (P7 §7). For one of today's meetings, assemble a
 * concise, deterministic markdown brief from the client's recent context: health,
 * attendees, recent history (master record + recent meetings), and open tasks.
 * Deterministic (no AI dependency) so the morning cron is reliable; the AI compose
 * is an optional future enhancement (the §7 "Optionally AI-compose").
 */
import type { Json, ServerClient } from '@gracie/db';

/** The subset of a meeting row the brief needs. */
export interface BriefMeeting {
  readonly id: string;
  readonly title: string | null;
  readonly date_time: string;
  readonly client_id: string;
  readonly meeting_lead_user_id: string | null;
  readonly attendee_user_ids: string[];
  readonly external_attendees: Json;
}

/** Context shared across a run (so the builder avoids re-fetching lookups). */
export interface BriefContext {
  readonly clientName: string;
  readonly health: number | null;
  /** `users.id` → display name, for attendee + lead rendering. */
  readonly usersById: ReadonlyMap<string, string>;
}

/** Format an ISO instant as an Eastern date+time label. */
function etDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** Parse `external_attendees` jsonb into display names (name, else email). */
function externalNames(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' && rec.name.trim() !== '' ? rec.name.trim() : null;
    const email = typeof rec.email === 'string' ? rec.email.trim() : null;
    const label = name ?? email;
    if (label !== null && label !== '') out.push(label);
  }
  return out;
}

/** Clamp a one-line summary to a readable length. */
function clampLine(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

/**
 * Build the markdown brief body for one meeting. Runs a few small client-scoped
 * reads; safe to call once per today's meeting.
 */
export async function buildBriefContent(
  db: ServerClient,
  meeting: BriefMeeting,
  ctx: BriefContext,
): Promise<string> {
  const lines: string[] = [];
  const leadName =
    meeting.meeting_lead_user_id !== null ? ctx.usersById.get(meeting.meeting_lead_user_id) ?? null : null;
  const healthLabel = ctx.health !== null ? `${ctx.health}/100` : 'n/a';

  lines.push(`Client: ${ctx.clientName} · Relationship health: ${healthLabel}`);
  lines.push(`When: ${etDateTime(meeting.date_time)}${leadName !== null ? ` · Lead: ${leadName}` : ''}`);

  const internalNames = meeting.attendee_user_ids
    .map((id) => ctx.usersById.get(id))
    .filter((n): n is string => n !== undefined);
  if (internalNames.length > 0) lines.push(`Internal: ${internalNames.join(', ')}`);
  const external = externalNames(meeting.external_attendees);
  if (external.length > 0) lines.push(`External: ${external.join(', ')}`);

  // Recent history — master record digest entries (most recent first).
  const master = await db
    .from('master_record_entries')
    .select('summary, created_at')
    .eq('client_id', meeting.client_id)
    .order('created_at', { ascending: false })
    .limit(3);
  if (master.error !== null) throw new Error(`brief: master record: ${master.error.message}`);
  if ((master.data ?? []).length > 0) {
    lines.push('');
    lines.push('Recent history:');
    for (const row of master.data ?? []) {
      lines.push(`- ${row.created_at.slice(0, 10)}: ${clampLine(row.summary)}`);
    }
  }

  // Recent completed meetings (context on cadence), excluding this one.
  const recent = await db
    .from('meetings')
    .select('title, date_time')
    .eq('client_id', meeting.client_id)
    .eq('pipeline_status', 'complete')
    .neq('id', meeting.id)
    .order('date_time', { ascending: false })
    .limit(3);
  if (recent.error !== null) throw new Error(`brief: recent meetings: ${recent.error.message}`);
  if ((recent.data ?? []).length > 0) {
    lines.push('');
    lines.push('Recent meetings:');
    for (const row of recent.data ?? []) {
      lines.push(`- ${row.date_time.slice(0, 10)}: ${row.title ?? 'Untitled meeting'}`);
    }
  }

  // Open action items.
  const tasks = await db
    .from('tasks')
    .select('description, due_date, priority_flag')
    .eq('client_id', meeting.client_id)
    .neq('status', 'complete')
    .eq('archived', false)
    .order('priority_flag', { ascending: false })
    .limit(8);
  if (tasks.error !== null) throw new Error(`brief: open tasks: ${tasks.error.message}`);
  if ((tasks.data ?? []).length > 0) {
    lines.push('');
    lines.push('Open items:');
    for (const t of tasks.data ?? []) {
      const due = t.due_date !== null ? ` (due ${t.due_date})` : '';
      const flag = t.priority_flag ? ' [priority]' : '';
      lines.push(`- ${clampLine(t.description)}${due}${flag}`);
    }
  }

  if (lines.length === 2) {
    // Only the header lines — no recorded context yet.
    lines.push('');
    lines.push('No prior history recorded for this client yet.');
  }

  return lines.join('\n');
}
