/**
 * Relationship-health recompute processor (P2.1, docs/plan/p2.1-stage-a-plan.md §2).
 *
 * Computes a client's 0–100 health score from four weighted signals (cadence
 * adherence, meeting recency, open/overdue tasks, completion rate) via the pure
 * `@gracie/shared` calc, applies any admin per-signal adjustments, derives the trend
 * from history, and writes `relationship_health` / `relationship_trend` /
 * `last_meeting_at` / `health_updated_at` back on the client — plus a snapshot into
 * `client_health_history`. One job owns BOTH the score and the `last_meeting_at` sync.
 *
 * Two shapes share the queue: a nightly sweep (no `clientId` → all active clients) and
 * event-triggered single-client jobs (the web app enqueues one after a meeting ingest,
 * task, note, or cadence change). Config is read from the tunable `settings` row, with a
 * hardcoded default fallback.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Json, ServerClient } from '@gracie/db';
import {
  computeHealth,
  deriveTrend,
  parseHealthAdjustments,
  parseHealthConfig,
  type HealthConfig,
  type HealthInputs,
  type HealthTaskInput,
  type RelationshipHealthJobPayload,
} from '@gracie/shared';

const HEALTH_CONFIG_SETTING_KEY = 'relationship_health_config';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Outcome of one recompute job (visible in Bull Board). */
export interface RelationshipHealthResult {
  readonly recomputed: number;
}

/** Read the tunable algorithm config from `settings`, falling back to the default. */
async function loadHealthConfig(db: ServerClient): Promise<HealthConfig> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', HEALTH_CONFIG_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`relationship-health: load config: ${error.message}`);
  return parseHealthConfig(data?.value ?? null);
}

/**
 * Recompute + persist one client's health. Returns the new score, or null if the
 * client no longer exists (a race with a delete — skip, don't fail the sweep).
 */
async function recomputeClient(
  db: ServerClient,
  clientId: string,
  config: HealthConfig,
  now: Date,
): Promise<number | null> {
  const clientRes = await db
    .from('clients')
    .select('id, cadence, health_adjustments')
    .eq('id', clientId)
    .maybeSingle();
  if (clientRes.error !== null) throw new Error(`relationship-health: load client: ${clientRes.error.message}`);
  if (clientRes.data === null) return null;

  // Last COMPLETED / transcript-received meeting (drives recency + cadence adherence).
  const meetingRes = await db
    .from('meetings')
    .select('date_time, transcript_received, pipeline_status')
    .eq('client_id', clientId)
    .lte('date_time', now.toISOString())
    .order('date_time', { ascending: false });
  if (meetingRes.error !== null) throw new Error(`relationship-health: load meetings: ${meetingRes.error.message}`);
  const latestCompleted = (meetingRes.data ?? []).find(
    (m) => m.transcript_received === true || m.pipeline_status === 'complete',
  );
  const lastMeetingAt = latestCompleted?.date_time ?? null;
  const hasCompletedMeeting = latestCompleted !== undefined;

  // Active (non-archived) tasks feed the open/overdue + completion signals.
  const taskRes = await db
    .from('tasks')
    .select('status, due_date')
    .eq('client_id', clientId)
    .eq('archived', false);
  if (taskRes.error !== null) throw new Error(`relationship-health: load tasks: ${taskRes.error.message}`);
  const tasks: HealthTaskInput[] = (taskRes.data ?? []).map((t) => ({
    status: t.status,
    dueDate: t.due_date,
  }));

  const inputs: HealthInputs = {
    cadence: clientRes.data.cadence,
    lastMeetingAt,
    hasCompletedMeeting,
    tasks,
  };
  const adjustments = parseHealthAdjustments(clientRes.data.health_adjustments);
  const breakdown = computeHealth(inputs, config, adjustments, now);

  // Trend: compare to the newest snapshot at least `trendCompareDays` old.
  const cutoff = new Date(now.getTime() - config.trendCompareDays * MS_PER_DAY).toISOString();
  const priorRes = await db
    .from('client_health_history')
    .select('score')
    .eq('client_id', clientId)
    .lte('computed_at', cutoff)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorRes.error !== null) throw new Error(`relationship-health: load prior: ${priorRes.error.message}`);
  const trend = deriveTrend(breakdown.score, priorRes.data?.score ?? null, config);

  const nowIso = now.toISOString();
  const updateRes = await db
    .from('clients')
    .update({
      relationship_health: breakdown.score,
      relationship_trend: trend,
      last_meeting_at: lastMeetingAt,
      health_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', clientId);
  if (updateRes.error !== null) throw new Error(`relationship-health: update client: ${updateRes.error.message}`);

  const snapRes = await db.from('client_health_history').insert({
    client_id: clientId,
    score: breakdown.score,
    breakdown: breakdown as unknown as Json,
  });
  if (snapRes.error !== null) throw new Error(`relationship-health: snapshot: ${snapRes.error.message}`);

  return breakdown.score;
}

/** Build the relationship-health processor, logging through the worker's Fastify logger. */
export function createRelationshipHealthProcessor(
  logger: FastifyBaseLogger,
): Processor<RelationshipHealthJobPayload, RelationshipHealthResult> {
  return async (job: Job<RelationshipHealthJobPayload>): Promise<RelationshipHealthResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const now = new Date();
    const config = await loadHealthConfig(db);

    // Single-client event recompute.
    if (job.data.clientId !== undefined) {
      const score = await recomputeClient(db, job.data.clientId, config, now);
      if (score === null) {
        log.warn({ clientId: job.data.clientId }, 'relationship-health: client not found');
        return { recomputed: 0 };
      }
      log.info(
        { clientId: job.data.clientId, score, source: job.data.source },
        'relationship-health: recomputed client',
      );
      return { recomputed: 1 };
    }

    // Nightly sweep — every active client. A single bad client never aborts the sweep.
    const clientsRes = await db.from('clients').select('id').eq('type', 'client');
    if (clientsRes.error !== null) {
      throw new Error(`relationship-health: list clients: ${clientsRes.error.message}`);
    }
    const ids = (clientsRes.data ?? []).map((c) => c.id);
    let recomputed = 0;
    for (const id of ids) {
      try {
        const score = await recomputeClient(db, id, config, now);
        if (score !== null) recomputed += 1;
      } catch (err) {
        log.error({ clientId: id, err }, 'relationship-health: client recompute failed');
      }
    }
    log.info({ recomputed, total: ids.length, source: job.data.source }, 'relationship-health sweep');
    return { recomputed };
  };
}
