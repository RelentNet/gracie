/**
 * Runtime credential resolution + management for third-party integrations
 * (docs/07 credential resolution, docs/05 API Settings). This is what makes API
 * keys configurable from Admin → API Settings (so a self-hosted/resold instance
 * can set its own keys with no code or env changes).
 *
 * Resolution (getCredential): stored row (decrypted) → env fallback → null,
 * cached briefly. Server-only (service-role client).
 */
import { getServerClient } from './client.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import type { Database, Json } from './database.types.js';

export type IntegrationKey = Database['public']['Enums']['integration_key'];

/** Public (no-secret) view of a stored integration row for API Settings. */
export interface IntegrationStatus {
  readonly service: IntegrationKey;
  readonly label: string;
  readonly isSet: boolean;
  readonly config: Json;
  readonly lastTestedAt: string | null;
  readonly lastTestOk: boolean | null;
}

/** Services manageable from Admin → API Settings (excludes env-only bootstrap). */
export const MANAGEABLE_SERVICES: readonly IntegrationKey[] = [
  'recall',
  'openai',
  'anthropic',
  'resend',
  'r2',
  'ms_graph',
] as const;

/** Default human label per service (used when first creating a row). */
const DEFAULT_LABELS: Record<IntegrationKey, string> = {
  recall: 'Recall.ai API Key',
  openai: 'OpenAI API Key',
  anthropic: 'Anthropic API Key',
  resend: 'Resend API Key',
  r2: 'Object Storage (MinIO/S3) Access Key',
  ms_graph: 'Microsoft Graph Client Secret',
  logto: 'Logto',
  supabase: 'Supabase',
};

/** Env-var fallback per service (docs/07 step 2). */
const ENV_FALLBACK: Partial<Record<IntegrationKey, string>> = {
  recall: 'RECALL_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  resend: 'RESEND_API_KEY',
  ms_graph: 'MS_CLIENT_SECRET',
};

interface CacheEntry {
  readonly value: string | null;
  readonly at: number;
}
const TTL_MS = 60_000;
const cache = new Map<IntegrationKey, CacheEntry>();

/** True for a service that can be managed in API Settings. */
export function isManageableService(value: string): value is IntegrationKey {
  return (MANAGEABLE_SERVICES as readonly string[]).includes(value);
}

/** Drop the cached secret for a service (after a set/clear). */
export function invalidateCredential(service: IntegrationKey): void {
  cache.delete(service);
}

/**
 * Resolve a service secret: stored (decrypted) → env fallback → null.
 * Cached for TTL_MS to avoid a DB round-trip on every AI call.
 */
export async function getCredential(service: IntegrationKey): Promise<string | null> {
  const hit = cache.get(service);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.value;

  const db = getServerClient();
  const { data, error } = await db
    .from('integration_credentials')
    .select('secret_encrypted, is_set')
    .eq('service', service)
    .maybeSingle();
  if (error !== null) throw new Error(`getCredential(${service}): ${error.message}`);

  let value: string | null = null;
  if (data?.is_set === true && data.secret_encrypted !== null) {
    value = decryptSecret(data.secret_encrypted);
  } else {
    const envName = ENV_FALLBACK[service];
    value = envName !== undefined ? (process.env[envName] ?? null) : null;
  }

  cache.set(service, { value, at: Date.now() });
  return value;
}

/** List manageable integrations with status (NO secrets), merged with defaults. */
export async function listIntegrations(): Promise<IntegrationStatus[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('integration_credentials')
    .select('service, label, is_set, config, last_tested_at, last_test_ok');
  if (error !== null) throw new Error(`listIntegrations: ${error.message}`);

  const byService = new Map((data ?? []).map((row) => [row.service, row]));
  return MANAGEABLE_SERVICES.map((service) => {
    const row = byService.get(service);
    return {
      service,
      label: row?.label ?? DEFAULT_LABELS[service],
      isSet: row?.is_set ?? false,
      config: row?.config ?? {},
      lastTestedAt: row?.last_tested_at ?? null,
      lastTestOk: row?.last_test_ok ?? null,
    };
  });
}

export interface SetIntegrationParams {
  readonly secret?: string;
  readonly config?: Json;
  readonly updatedByUserId?: string | null;
}

/** Set/replace a service's encrypted secret and/or non-secret config. */
export async function setIntegration(
  service: IntegrationKey,
  params: SetIntegrationParams,
): Promise<void> {
  const db = getServerClient();
  const row: Database['public']['Tables']['integration_credentials']['Insert'] = {
    service,
    label: DEFAULT_LABELS[service],
    updated_by_user_id: params.updatedByUserId ?? null,
  };
  if (params.config !== undefined) {
    row.config = params.config;
  }
  if (params.secret !== undefined && params.secret !== '') {
    row.secret_encrypted = encryptSecret(params.secret);
    row.is_set = true;
  }

  const { error } = await db.from('integration_credentials').upsert(row, { onConflict: 'service' });
  if (error !== null) throw new Error(`setIntegration(${service}): ${error.message}`);
  invalidateCredential(service);
}

/** Remove a stored secret (falls back to env). Keeps the row + config. */
export async function clearIntegrationSecret(service: IntegrationKey): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('integration_credentials')
    .update({ secret_encrypted: null, is_set: false })
    .eq('service', service);
  if (error !== null) throw new Error(`clearIntegrationSecret(${service}): ${error.message}`);
  invalidateCredential(service);
}

/** Record a Test Connection result for the API Settings status UI. */
export async function recordTestResult(service: IntegrationKey, ok: boolean): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('integration_credentials')
    .update({ last_test_ok: ok, last_tested_at: new Date().toISOString() })
    .eq('service', service);
  if (error !== null) throw new Error(`recordTestResult(${service}): ${error.message}`);
}
