/**
 * Pipeline admin data layer (Settings/Pipeline, P9). Reads failed/partial
 * `pipeline_runs` for the admin error log and resolves the meeting info a manual
 * re-trigger needs. Admin-only surface — permission enforcement is the API layer's
 * job; this layer takes explicit ids and never derives identity from client input.
 *
 * Server-only (service-role client).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

/** The pipeline_run statuses that count as "needs attention". */
export type PipelineErrorStatus = 'failed' | 'partial';

export interface PipelineRunView {
  readonly id: string;
  readonly meetingId: string | null;
  readonly meetingTitle: string | null;
  readonly clientName: string | null;
  readonly meetingDate: string | null;
  readonly status: PipelineErrorStatus | null;
  readonly source: string;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly documentsGenerated: number;
  readonly durationSeconds: number | null;
  /** True when the meeting still exists and has a bot recording to regenerate from. */
  readonly canRetrigger: boolean;
}

/**
 * List recent failed/partial pipeline runs (newest first), enriched with the
 * meeting title + client name for display. Resolves meeting/client info in bulk
 * lookups (mirrors the app's other list-with-names data functions).
 */
export async function listPipelineRunErrors(
  statuses: readonly PipelineErrorStatus[],
  limit = 50,
): Promise<PipelineRunView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('pipeline_runs')
    .select('*')
    .in('status', [...statuses])
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error !== null) throw new Error(`listPipelineRunErrors: ${error.message}`);
  const runs = data ?? [];

  const meetingIds = [...new Set(runs.map((r) => r.meeting_id).filter((v): v is string => v !== null))];
  const meetings = new Map<string, { title: string | null; dateTime: string; clientId: string | null; botJobId: string | null }>();
  if (meetingIds.length > 0) {
    const mRes = await db.from('meetings').select('id, title, date_time, client_id, bot_job_id').in('id', meetingIds);
    if (mRes.error !== null) throw new Error(`listPipelineRunErrors(meetings): ${mRes.error.message}`);
    for (const m of mRes.data ?? []) {
      meetings.set(m.id, { title: m.title, dateTime: m.date_time, clientId: m.client_id, botJobId: m.bot_job_id });
    }
  }

  const clientIds = [
    ...new Set([...meetings.values()].map((m) => m.clientId).filter((v): v is string => v !== null)),
  ];
  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const cRes = await db.from('clients').select('id, name').in('id', clientIds);
    if (cRes.error !== null) throw new Error(`listPipelineRunErrors(clients): ${cRes.error.message}`);
    for (const c of cRes.data ?? []) clientNames.set(c.id, c.name);
  }

  return runs.map((r) => {
    const m = r.meeting_id !== null ? meetings.get(r.meeting_id) : undefined;
    return {
      id: r.id,
      meetingId: r.meeting_id,
      meetingTitle: m?.title ?? null,
      clientName: m?.clientId != null ? clientNames.get(m.clientId) ?? null : null,
      meetingDate: m?.dateTime ?? null,
      status: r.status as PipelineErrorStatus | null,
      source: r.source,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      documentsGenerated: r.documents_generated,
      durationSeconds: r.duration_seconds,
      canRetrigger: m !== undefined && m.botJobId !== null && m.botJobId !== '',
    };
  });
}

/** Fetch the id + bot job id for a meeting (re-trigger pre-check); null if not found. */
export async function getMeetingForRetrigger(meetingId: string): Promise<{ id: string; botJobId: string | null } | null> {
  const db = getServerClient();
  const { data, error } = await db.from('meetings').select('id, bot_job_id').eq('id', meetingId).maybeSingle();
  if (error !== null) throw new Error(`getMeetingForRetrigger: ${error.message}`);
  return data === null ? null : { id: data.id, botJobId: data.bot_job_id };
}

/** Mark a meeting as re-processing before a manual generation re-trigger (mirrors the webhook). */
export async function markMeetingProcessing(meetingId: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('meetings')
    .update({ pipeline_status: 'processing', pipeline_started_at: new Date().toISOString() })
    .eq('id', meetingId);
  if (error !== null) throw new Error(`markMeetingProcessing: ${error.message}`);
}
