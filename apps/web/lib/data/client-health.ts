/**
 * Server-side data access for relationship-health detail (P2.1).
 *
 * The stored SCORE + trend live on the `clients` row (written by the worker's
 * recompute job); this module reads them plus the latest computed breakdown (from
 * `client_health_history`) and the admin per-signal adjustments (`clients.health_adjustments`)
 * into the {@link ClientHealth} view, and lets an admin set/clear an adjustment. It
 * never computes the score — that's the worker's job — it only reads state + edits
 * the adjustment inputs. Service-role client; permission gating is the API's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Json } from '@gracie/db';
import { parseHealthAdjustments } from '@gracie/shared';
import type {
  ClientHealth,
  HealthAdjustment,
  HealthAdjustments,
  HealthBreakdown,
  HealthSignalKey,
} from '@gracie/shared';

/**
 * Read a client's health detail — stored score/trend/freshness + the latest computed
 * breakdown + admin adjustments. Returns null when the client doesn't exist.
 */
export async function getClientHealth(clientId: string): Promise<ClientHealth | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('clients')
    .select('relationship_health, relationship_trend, health_updated_at, health_adjustments')
    .eq('id', clientId)
    .maybeSingle();
  if (error !== null) throw new Error(`getClientHealth: ${error.message}`);
  if (data === null) return null;

  const history = await db
    .from('client_health_history')
    .select('breakdown')
    .eq('client_id', clientId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (history.error !== null) throw new Error(`getClientHealth(history): ${history.error.message}`);

  return {
    score: data.relationship_health,
    trend: data.relationship_trend,
    updatedAt: data.health_updated_at,
    breakdown: (history.data?.breakdown as HealthBreakdown | null) ?? null,
    adjustments: parseHealthAdjustments(data.health_adjustments),
  };
}

/**
 * Set an admin adjustment for a single signal (P2.1, admin-gated at the API). Merges
 * into the existing adjustments and bumps `updated_at`; returns the full new map. The
 * caller enqueues a recompute so the adjustment takes effect on the score immediately.
 */
export async function setHealthAdjustment(
  clientId: string,
  key: HealthSignalKey,
  value: number,
  reason: string,
  byUserId: string | null,
): Promise<HealthAdjustments> {
  const db = getServerClient();
  const current = await db
    .from('clients')
    .select('health_adjustments')
    .eq('id', clientId)
    .maybeSingle();
  if (current.error !== null) throw new Error(`setHealthAdjustment: ${current.error.message}`);
  if (current.data === null) throw new Error('Unknown client');

  const next: HealthAdjustments = {
    ...parseHealthAdjustments(current.data.health_adjustments),
    [key]: { value, reason: reason.trim(), byUserId, at: new Date().toISOString() },
  };
  const { error } = await db
    .from('clients')
    .update({ health_adjustments: next as unknown as Json, updated_at: new Date().toISOString() })
    .eq('id', clientId);
  if (error !== null) throw new Error(`setHealthAdjustment: ${error.message}`);
  return next;
}

/** Clear an admin adjustment for a single signal (P2.1). Returns the remaining map. */
export async function clearHealthAdjustment(
  clientId: string,
  key: HealthSignalKey,
): Promise<HealthAdjustments> {
  const db = getServerClient();
  const current = await db
    .from('clients')
    .select('health_adjustments')
    .eq('id', clientId)
    .maybeSingle();
  if (current.error !== null) throw new Error(`clearHealthAdjustment: ${current.error.message}`);
  if (current.data === null) throw new Error('Unknown client');

  const next: Record<string, HealthAdjustment> = { ...parseHealthAdjustments(current.data.health_adjustments) };
  delete next[key];
  const { error } = await db
    .from('clients')
    .update({ health_adjustments: next as unknown as Json, updated_at: new Date().toISOString() })
    .eq('id', clientId);
  if (error !== null) throw new Error(`clearHealthAdjustment: ${error.message}`);
  return next;
}
