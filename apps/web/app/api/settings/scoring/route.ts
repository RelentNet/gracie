/**
 * Admin-only Scoring settings (Settings → Scoring, P9). Reads/writes the GLOBAL
 * relationship-health algorithm config (`settings.relationship_health_config`) —
 * the 4 signal weights + thresholds/intervals. On a successful write it enqueues a
 * FULL recompute sweep so retuned weights take effect immediately instead of
 * waiting for the nightly run.
 *
 *   GET   → `{ config, defaults }`
 *   PATCH → partial config patch → `{ config, recompute: { enqueued, error? } }`
 *
 * Gated on `scoring.configure` (admin tier) on BOTH read and write; a non-admin
 * receives 403. This is the global config — the per-client signal override lives
 * on the client's HealthCard and is untouched here.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can, HEALTH_SIGNAL_KEYS, CLIENT_CADENCES, type HealthSignalKey, type ClientCadence } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { enqueueRelationshipHealthSweep } from '@/lib/queue';
import {
  getScoringConfig,
  getScoringDefaults,
  setScoringConfig,
  ScoringValidationError,
  type ScoringConfigPatch,
} from '@/lib/data/scoring-settings';

// @gracie/db (service-role client) + BullMQ producer are Node-only.
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'scoring.configure')) return forbidden();
    return NextResponse.json({ config: await getScoringConfig(), defaults: getScoringDefaults() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'scoring_settings_read_failed', message } }, { status: 500 });
  }
}

/** Extract a required-numeric field: undefined if absent, or an error string if present-but-not-a-number. */
function numField(raw: Record<string, unknown>, key: string): number | undefined | { error: string } {
  if (!(key in raw) || raw[key] === undefined) return undefined;
  const v = raw[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${key} must be a number.` };
  return v;
}

/** Shape the untrusted body into a typed patch, rejecting present-but-wrong-typed fields. */
function parsePatch(body: Record<string, unknown>): ScoringConfigPatch | { error: string } {
  const patch: {
    weights?: Partial<Record<HealthSignalKey, number>>;
    cadenceIntervalDays?: Partial<Record<ClientCadence, number>>;
    recencyFullDays?: number;
    recencyZeroDays?: number;
    overduePenaltyPerTask?: number;
    overdueAgePenaltyPerDay?: number;
    noMeetingsScore?: number;
    trendCompareDays?: number;
    trendThreshold?: number;
  } = {};

  if (body.weights !== undefined) {
    if (body.weights === null || typeof body.weights !== 'object' || Array.isArray(body.weights)) {
      return { error: 'weights must be an object.' };
    }
    const rw = body.weights as Record<string, unknown>;
    const weights: Partial<Record<HealthSignalKey, number>> = {};
    for (const key of HEALTH_SIGNAL_KEYS) {
      const v = numField(rw, key);
      if (typeof v === 'object' && v !== null) return { error: `weights.${v.error}` };
      if (v !== undefined) weights[key] = v as number;
    }
    if (Object.keys(weights).length > 0) patch.weights = weights;
  }

  if (body.cadenceIntervalDays !== undefined) {
    if (
      body.cadenceIntervalDays === null ||
      typeof body.cadenceIntervalDays !== 'object' ||
      Array.isArray(body.cadenceIntervalDays)
    ) {
      return { error: 'cadenceIntervalDays must be an object.' };
    }
    const rc = body.cadenceIntervalDays as Record<string, unknown>;
    const cadence: Partial<Record<ClientCadence, number>> = {};
    for (const key of CLIENT_CADENCES) {
      const v = numField(rc, key);
      if (typeof v === 'object' && v !== null) return { error: v.error };
      if (v !== undefined) cadence[key] = v as number;
    }
    if (Object.keys(cadence).length > 0) patch.cadenceIntervalDays = cadence;
  }

  const scalarKeys = [
    'recencyFullDays',
    'recencyZeroDays',
    'overduePenaltyPerTask',
    'overdueAgePenaltyPerDay',
    'noMeetingsScore',
    'trendCompareDays',
    'trendThreshold',
  ] as const;
  for (const key of scalarKeys) {
    const v = numField(body, key);
    if (typeof v === 'object' && v !== null) return { error: v.error };
    if (v !== undefined) patch[key] = v as number;
  }

  return patch;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'scoring.configure')) return forbidden();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest('Body must be an object.');
    }

    const parsed = parsePatch(body);
    if ('error' in parsed) return badRequest(parsed.error);
    if (Object.keys(parsed).length === 0) return badRequest('No scoring fields to update.');

    let config;
    try {
      config = await setScoringConfig(parsed, user.userId);
    } catch (err) {
      if (err instanceof ScoringValidationError) return badRequest(err.message);
      throw err;
    }

    // Recompute all clients with the new config — best-effort so a Redis blip never
    // fails the save (the nightly sweep is the backstop).
    let recompute: { enqueued: boolean; error?: string };
    try {
      await enqueueRelationshipHealthSweep('scoring-config');
      recompute = { enqueued: true };
    } catch (err) {
      recompute = { enqueued: false, error: err instanceof Error ? err.message : 'Could not enqueue recompute.' };
    }

    return NextResponse.json({ config, recompute });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'scoring_settings_write_failed', message } }, { status: 500 });
  }
}
