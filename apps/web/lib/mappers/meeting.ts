/**
 * Row mapper for meetings — converts raw Supabase rows (snake_case) to the
 * camelCase `Meeting` domain type in `@gracie/shared`. Keeps the DB↔domain
 * boundary explicit, mirroring lib/mappers.ts (the clients template).
 */
import type { Database, Json } from '@gracie/db';
import type { ExternalAttendee, Meeting } from '@gracie/shared';

type MeetingRow = Database['public']['Tables']['meetings']['Row'];

/** Coerce the raw `meetings.external_attendees` jsonb into typed attendees. */
export function mapExternalAttendees(value: Json): ExternalAttendee[] {
  if (!Array.isArray(value)) return [];
  const out: ExternalAttendee[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const email = entry.email;
    const domain = entry.domain;
    if (typeof email !== 'string' || typeof domain !== 'string') continue;
    out.push({ email, domain, name: typeof entry.name === 'string' ? entry.name : null });
  }
  return out;
}

export function mapMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    dateTime: row.date_time,
    durationMinutes: row.duration_minutes,
    meetingType: row.meeting_type,
    meetingLeadUserId: row.meeting_lead_user_id,
    attendeeUserIds: row.attendee_user_ids,
    calendarEventId: row.calendar_event_id,
    videoLink: row.video_link,
    isBotDispatched: row.bot_dispatched,
    botJobId: row.bot_job_id,
    isTranscriptReceived: row.transcript_received,
    isInternal: row.is_internal,
    externalAttendees: mapExternalAttendees(row.external_attendees),
    pipelineStatus: row.pipeline_status,
    pipelineStartedAt: row.pipeline_started_at,
    pipelineCompletedAt: row.pipeline_completed_at,
    hasOpenItems: row.has_open_items,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
