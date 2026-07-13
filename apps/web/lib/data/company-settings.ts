/**
 * Company settings data layer (Settings → Company, P9). Admin-only surface over two
 * SQL-only identity settings:
 *  - `ga_company_description` — the firm blurb the Assistant + generation prompts use
 *    (read by `getGaCompanyDescription` / the worker's generate prompt).
 *  - `internal_email_domains` — the comma-separated list of GA's own email domains
 *    that classify a meeting as internal + are excluded from client-domain matching
 *    (read by the calendar scan + contact-suggestions worker via `parseInternalDomains`).
 *
 * Both are stored as JSON STRINGS to match those readers exactly. The internal-domain
 * floor (`graceandassociates.com`) can never be removed, so the internal-classification
 * decision can never silently open up.
 *
 * Server-only (service-role client); permission enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import { DEFAULT_INTERNAL_DOMAINS, isFreeEmailDomain, parseInternalDomains } from '@gracie/shared';

const COMPANY_DESCRIPTION_KEY = 'ga_company_description';
const INTERNAL_DOMAINS_KEY = 'internal_email_domains';

/** Mirrors the fallback in `chat-retrieval.getGaCompanyDescription`. */
const DEFAULT_COMPANY_DESCRIPTION = 'Grace & Associates — a federal healthcare consulting firm.';

const MAX_DESCRIPTION_LEN = 5000;
/** Basic hostname shape: labels of a–z/0–9/-, a dot, a ≥2-char TLD; no '@'/spaces. */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export interface CompanySettings {
  readonly companyDescription: string;
  readonly internalDomains: readonly string[];
  /** Floor domains that can never be removed (kept present on every save). */
  readonly floorDomains: readonly string[];
}

export interface CompanySettingsPatch {
  readonly companyDescription?: string;
  readonly internalDomains?: readonly string[];
}

/** Thrown on invalid input so the route can answer 400 (vs. 500). */
export class CompanySettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanySettingsValidationError';
  }
}

/** Read company description + internal domains (defaults merged in). */
export async function getCompanySettings(): Promise<CompanySettings> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('key, value')
    .in('key', [COMPANY_DESCRIPTION_KEY, INTERNAL_DOMAINS_KEY]);
  if (error !== null) throw new Error(`getCompanySettings: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const descRaw = byKey.get(COMPANY_DESCRIPTION_KEY);
  const domainsRaw = byKey.get(INTERNAL_DOMAINS_KEY);

  return {
    companyDescription:
      typeof descRaw === 'string' && descRaw.trim() !== '' ? descRaw : DEFAULT_COMPANY_DESCRIPTION,
    internalDomains: [...parseInternalDomains(typeof domainsRaw === 'string' ? domainsRaw : null)].sort(),
    floorDomains: DEFAULT_INTERNAL_DOMAINS,
  };
}

/** Validate + normalize a submitted internal-domain list (lowercased, deduped, floor kept). */
function normalizeDomains(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') throw new CompanySettingsValidationError('Each domain must be text.');
    const d = raw.trim().toLowerCase();
    if (d === '') continue;
    if (d.includes('@')) throw new CompanySettingsValidationError(`Enter a domain, not an email: “${raw}”.`);
    if (!DOMAIN_RE.test(d)) throw new CompanySettingsValidationError(`“${raw}” is not a valid domain.`);
    if (isFreeEmailDomain(d)) {
      throw new CompanySettingsValidationError(`“${d}” is a public email provider and can’t be an internal domain.`);
    }
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  // The floor domain(s) can never be removed — the internal decision must never open up.
  for (const floor of DEFAULT_INTERNAL_DOMAINS) {
    if (!seen.has(floor)) {
      throw new CompanySettingsValidationError(`${floor} is required and can’t be removed.`);
    }
  }
  if (out.length === 0) throw new CompanySettingsValidationError('At least one internal domain is required.');
  return out.sort();
}

/**
 * Persist company description and/or internal domains as JSON strings (matching the
 * worker + chat readers). Admin-gated at the route. Returns the fresh settings.
 */
export async function setCompanySettings(
  patch: CompanySettingsPatch,
  updatedByUserId: string | null,
): Promise<CompanySettings> {
  const rows: Array<{ key: string; value: string; updated_by_user_id: string | null; updated_at: string }> = [];
  const stamp = { updated_by_user_id: updatedByUserId, updated_at: new Date().toISOString() };

  if (patch.companyDescription !== undefined) {
    const desc = patch.companyDescription.trim();
    if (desc === '') throw new CompanySettingsValidationError('Company description can’t be empty.');
    if (desc.length > MAX_DESCRIPTION_LEN) {
      throw new CompanySettingsValidationError(`Company description must be ${MAX_DESCRIPTION_LEN} characters or fewer.`);
    }
    rows.push({ key: COMPANY_DESCRIPTION_KEY, value: desc, ...stamp });
  }

  if (patch.internalDomains !== undefined) {
    const domains = normalizeDomains(patch.internalDomains);
    rows.push({ key: INTERNAL_DOMAINS_KEY, value: domains.join(','), ...stamp });
  }

  if (rows.length > 0) {
    const db = getServerClient();
    const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
    if (error !== null) throw new Error(`setCompanySettings: ${error.message}`);
  }
  return getCompanySettings();
}
