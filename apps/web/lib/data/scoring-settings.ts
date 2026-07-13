/**
 * Scoring (relationship-health) config data layer (P9). The single place the
 * admin-only Scoring settings route reads/writes the GLOBAL algorithm config —
 * the tunable `settings.relationship_health_config` row seeded by migration 0007.
 *
 * Unlike the scalar-string settings (`internal_email_domains`, the boolean
 * toggles), this value is a jsonb OBJECT: it is written as an object and read back
 * through the SAME shared `parseHealthConfig` the worker's recompute uses, so the
 * app and the worker never disagree on the shape or the defaults.
 *
 * This is the GLOBAL config; the per-client per-signal override (`HealthCard` +
 * `/api/clients/[id]/health`) is a separate, already-shipped surface — untouched.
 *
 * Server-only (service-role client); permission enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Json } from '@gracie/db';
import {
  CLIENT_CADENCES,
  DEFAULT_HEALTH_CONFIG,
  HEALTH_SIGNAL_KEYS,
  parseHealthConfig,
  type ClientCadence,
  type HealthConfig,
  type HealthSignalKey,
} from '@gracie/shared';

const HEALTH_CONFIG_SETTING_KEY = 'relationship_health_config';

/** A partial patch of the config — every field optional; merged over the current row. */
export interface ScoringConfigPatch {
  readonly weights?: Partial<Record<HealthSignalKey, number>>;
  readonly cadenceIntervalDays?: Partial<Record<ClientCadence, number>>;
  readonly recencyFullDays?: number;
  readonly recencyZeroDays?: number;
  readonly overduePenaltyPerTask?: number;
  readonly overdueAgePenaltyPerDay?: number;
  readonly noMeetingsScore?: number;
  readonly trendCompareDays?: number;
  readonly trendThreshold?: number;
}

/** Thrown on invalid config so the route can answer 400 (vs. a 500 for real failures). */
export class ScoringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringValidationError';
  }
}

/** Read the current global relationship-health config (defaults merged in). */
export async function getScoringConfig(): Promise<HealthConfig> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', HEALTH_CONFIG_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getScoringConfig: ${error.message}`);
  return parseHealthConfig(data?.value ?? null);
}

/** Bounds for one numeric field. */
interface NumBounds {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

/** Validate a single number field, throwing a friendly ScoringValidationError. */
function requireNumber(value: number, field: string, bounds: NumBounds): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScoringValidationError(`${field} must be a number.`);
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    throw new ScoringValidationError(`${field} must be a whole number.`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new ScoringValidationError(`${field} must be between ${bounds.min} and ${bounds.max}.`);
  }
  return value;
}

/**
 * Merge a patch over the current config and validate the RESULT as a whole (so a
 * partial patch can never leave the stored config internally inconsistent — e.g.
 * `recencyZero` ending up below `recencyFull`). Returns a complete, valid config.
 */
export function validateMergedConfig(current: HealthConfig, patch: ScoringConfigPatch): HealthConfig {
  // Weights — non-negative; the algo renormalizes, but they must not ALL be zero.
  const weights = { ...current.weights };
  for (const key of HEALTH_SIGNAL_KEYS) {
    const v = patch.weights?.[key];
    if (v !== undefined) weights[key] = requireNumber(v, `weights.${key}`, { min: 0, max: 1000 });
  }
  if (HEALTH_SIGNAL_KEYS.reduce((sum, k) => sum + weights[k], 0) <= 0) {
    throw new ScoringValidationError('At least one signal weight must be greater than zero.');
  }

  // Cadence intervals — positive whole days per cadence (ad_hoc may stay omitted).
  const cadenceIntervalDays: Partial<Record<ClientCadence, number>> = { ...current.cadenceIntervalDays };
  for (const cadence of CLIENT_CADENCES) {
    const v = patch.cadenceIntervalDays?.[cadence];
    if (v !== undefined) {
      cadenceIntervalDays[cadence] = requireNumber(v, `cadenceIntervalDays.${cadence}`, {
        min: 1,
        max: 3650,
        integer: true,
      });
    }
  }

  type ScalarPatchKey =
    | 'recencyFullDays'
    | 'recencyZeroDays'
    | 'overduePenaltyPerTask'
    | 'overdueAgePenaltyPerDay'
    | 'noMeetingsScore'
    | 'trendCompareDays'
    | 'trendThreshold';
  const pick = (field: ScalarPatchKey, current_: number, bounds: NumBounds): number => {
    const v = patch[field];
    return v === undefined ? current_ : requireNumber(v, field, bounds);
  };

  const recencyFullDays = pick('recencyFullDays', current.recencyFullDays, { min: 0, max: 3650, integer: true });
  const recencyZeroDays = pick('recencyZeroDays', current.recencyZeroDays, { min: 0, max: 3650, integer: true });
  if (recencyZeroDays <= recencyFullDays) {
    throw new ScoringValidationError('Recency “zero” days must be greater than “full” days.');
  }

  return {
    weights,
    cadenceIntervalDays,
    recencyFullDays,
    recencyZeroDays,
    overduePenaltyPerTask: pick('overduePenaltyPerTask', current.overduePenaltyPerTask, { min: 0, max: 100 }),
    overdueAgePenaltyPerDay: pick('overdueAgePenaltyPerDay', current.overdueAgePenaltyPerDay, { min: 0, max: 100 }),
    noMeetingsScore: pick('noMeetingsScore', current.noMeetingsScore, { min: 0, max: 100, integer: true }),
    trendCompareDays: pick('trendCompareDays', current.trendCompareDays, { min: 1, max: 365, integer: true }),
    trendThreshold: pick('trendThreshold', current.trendThreshold, { min: 0, max: 100 }),
  };
}

/**
 * Validate + persist the merged config as a jsonb OBJECT (matching the 0007 seed +
 * the worker's `parseHealthConfig` reader). Stamps the editing admin for audit.
 * Returns the fresh, stored config. Admin-gated at the API layer; the caller
 * enqueues the recompute after this resolves.
 */
export async function setScoringConfig(
  patch: ScoringConfigPatch,
  updatedByUserId: string,
): Promise<HealthConfig> {
  const current = await getScoringConfig();
  const next = validateMergedConfig(current, patch);

  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    {
      key: HEALTH_CONFIG_SETTING_KEY,
      value: next as unknown as Json,
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setScoringConfig: ${error.message}`);
  return next;
}

/** The hardcoded defaults (for the panel's “reset to defaults” affordance + reference). */
export function getScoringDefaults(): HealthConfig {
  return DEFAULT_HEALTH_CONFIG;
}
