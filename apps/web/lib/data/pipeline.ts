/**
 * Pipeline admin data layer (Settings/Pipeline, P9 → §3.1 fleet view). Builds the
 * Pipeline activity feed and resolves the meeting info a manual re-trigger needs.
 * Admin-only surface — permission enforcement is the API layer's job; this layer
 * takes explicit ids and never derives identity from client input.
 *
 * Server-only (service-role client).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

import { describePipelineState, type FleetReason, type FleetState } from '../pipeline-reason';

/** A single row in the Pipeline activity feed (fleet view, §3.1). */
export interface FleetRowView {
  /** Stable row key — a run id, or `meeting:<id>` for a stuck meeting with no run. */
  readonly id: string;
  readonly meetingId: string | null;
  readonly title: string | null;
  readonly client: string | null;
  /** Meeting time (falls back to the run's start) for display + sort. */
  readonly when: string | null;
  readonly state: FleetState;
  readonly docsCount: number;
  readonly durationS: number | null;
  readonly botJobId: string | null;
  /** Mirrors the existing re-trigger pre-check: a bot recording exists to re-run from. */
  readonly canRetrigger: boolean;
  readonly reason: FleetReason;
}

/** Meeting pipeline_status values that mean "no run row yet, but not stuck" → in-progress. */
const IN_PROGRESS_STATES = ['scheduled', 'in_progress', 'awaiting_transcript', 'processing'] as const;

/**
 * Full Pipeline fleet view (§3.1): a union of (a) recent `pipeline_runs` of ALL
 * statuses (success / partial / failed, plus the status-null duplicate-skip
 * explanation rows) and (b) `meetings` that are stuck or in-progress with NO run
 * row at all — the watchdog-flagged `needs_attention` meetings and bot-dispatched
 * meetings still awaiting a transcript. Those no-run meetings are invisible in the
 * old error-only log; surfacing them is the whole point of this view.
 *
 * `needs_attention` rows are returned first; the rest are newest-first.
 */
export async function listPipelineFleet(limit = 100): Promise<FleetRowView[]> {
  const db = getServerClient();
  const cap = Math.min(Math.max(limit, 1), 200);

  // (a) Recent runs, all statuses.
  const runsRes = await db
    .from('pipeline_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cap);
  if (runsRes.error !== null) throw new Error(`listPipelineFleet(runs): ${runsRes.error.message}`);
  const runs = runsRes.data ?? [];
  const runMeetingIds = new Set(runs.map((r) => r.meeting_id).filter((v): v is string => v !== null));

  // Enrich runs with their meeting's title/date/client/bot.
  const meetingInfo = new Map<
    string,
    { title: string | null; dateTime: string; clientId: string | null; botJobId: string | null }
  >();
  if (runMeetingIds.size > 0) {
    const mRes = await db
      .from('meetings')
      .select('id, title, date_time, client_id, bot_job_id')
      .in('id', [...runMeetingIds]);
    if (mRes.error !== null) throw new Error(`listPipelineFleet(run meetings): ${mRes.error.message}`);
    for (const m of mRes.data ?? []) {
      meetingInfo.set(m.id, { title: m.title, dateTime: m.date_time, clientId: m.client_id, botJobId: m.bot_job_id });
    }
  }

  // (b) Stuck / in-progress meetings with NO run row.
  const stuckRes = await db
    .from('meetings')
    .select('id, title, date_time, client_id, bot_job_id, pipeline_status')
    .or(
      `pipeline_status.in.(needs_attention,processing,in_progress,awaiting_transcript),and(bot_dispatched.eq.true,transcript_received.eq.false)`,
    )
    .order('date_time', { ascending: false })
    .limit(cap);
  if (stuckRes.error !== null) throw new Error(`listPipelineFleet(stuck): ${stuckRes.error.message}`);
  const stuck = (stuckRes.data ?? []).filter((m) => !runMeetingIds.has(m.id));

  // Resolve client names across both sources.
  const clientIds = new Set<string>();
  for (const m of meetingInfo.values()) if (m.clientId !== null) clientIds.add(m.clientId);
  for (const m of stuck) if (m.client_id !== null) clientIds.add(m.client_id);
  const clientNames = new Map<string, string>();
  if (clientIds.size > 0) {
    const cRes = await db.from('clients').select('id, name').in('id', [...clientIds]);
    if (cRes.error !== null) throw new Error(`listPipelineFleet(clients): ${cRes.error.message}`);
    for (const c of cRes.data ?? []) clientNames.set(c.id, c.name);
  }

  const runRows: FleetRowView[] = runs.map((r) => {
    const m = r.meeting_id !== null ? meetingInfo.get(r.meeting_id) : undefined;
    const botJobId = m?.botJobId ?? null;
    // status null = the duplicate-invite skip note (explanation, not a failure).
    const state: FleetState = r.status ?? 'skipped';
    const hasRecording = botJobId !== null && botJobId !== '';
    return {
      id: r.id,
      meetingId: r.meeting_id,
      title: m?.title ?? null,
      client: m?.clientId != null ? clientNames.get(m.clientId) ?? null : null,
      when: m?.dateTime ?? r.started_at ?? r.created_at,
      state,
      docsCount: r.documents_generated,
      durationS: r.duration_seconds,
      botJobId,
      canRetrigger: hasRecording,
      reason: describePipelineState({ state, errorMessage: r.error_message, hasRecording }),
    };
  });

  const stuckRows: FleetRowView[] = stuck.map((m) => {
    const state: FleetState =
      m.pipeline_status === 'needs_attention'
        ? 'needs_attention'
        : (IN_PROGRESS_STATES as readonly string[]).includes(m.pipeline_status)
          ? 'in_progress'
          : 'in_progress';
    const hasRecording = m.bot_job_id !== null && m.bot_job_id !== '';
    return {
      id: `meeting:${m.id}`,
      meetingId: m.id,
      title: m.title,
      client: m.client_id !== null ? clientNames.get(m.client_id) ?? null : null,
      when: m.date_time,
      state,
      docsCount: 0,
      durationS: null,
      botJobId: m.bot_job_id,
      canRetrigger: hasRecording,
      reason: describePipelineState({ state, hasRecording }),
    };
  });

  // Pin needs_attention on top; everything else newest-first by `when`.
  const whenMs = (r: FleetRowView): number => (r.when !== null ? new Date(r.when).getTime() : 0);
  return [...runRows, ...stuckRows].sort((a, b) => {
    const aAttn = a.state === 'needs_attention' ? 1 : 0;
    const bAttn = b.state === 'needs_attention' ? 1 : 0;
    if (aAttn !== bAttn) return bAttn - aAttn;
    return whenMs(b) - whenMs(a);
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
