/**
 * Email-domain utilities for the meetings-first calendar (P4.1).
 *
 * PURE / dependency-free (no DB, no server-only) so both the worker scan and the
 * web data/API layers share ONE definition of "what counts as a client domain".
 * Domain identity is the primary calendar → client match key (docs/plan
 * p4.1-meetings-first-orgs.md §3–§4): a meeting's org(s) are derived from the
 * external email domains of its attendees, excluding Grace & Associates' own
 * internal domain(s) and public free-email providers.
 */

/**
 * Public free-email providers. These are NEVER org domains and are NEVER offered
 * for "create client from domain" — many unrelated people share `gmail.com`, so a
 * free-email domain can't identify a single organization. Extend as needed.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
]);

/** Fallback internal domain when `settings.internal_email_domains` is unset. */
export const DEFAULT_INTERNAL_DOMAINS: readonly string[] = ['graceandassociates.com'];

/** Extract the lower-cased domain from an email address, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain === '' ? null : domain;
}

/** True when `domain` is a known public free-email provider (lower-cased compare). */
export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  if (domain === null || domain === undefined) return false;
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * Parse the comma-separated `settings.internal_email_domains` value into a
 * lower-cased set. Falls back to {@link DEFAULT_INTERNAL_DOMAINS} when the value
 * is missing or blank, so the internal-meeting decision never silently opens up.
 */
export function parseInternalDomains(raw: string | null | undefined): Set<string> {
  const parts = (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
  return new Set(parts.length > 0 ? parts : DEFAULT_INTERNAL_DOMAINS);
}

/**
 * Common multi-label public suffixes (e.g. `co.uk`) whose second-to-last label is
 * NOT the organization name. Small, hand-curated list — not a full PSL.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'com.au',
  'com.br',
  'co.nz',
  'co.za',
]);

/**
 * A display name from a domain: the title-cased second-level label. `acme.com` →
 * `Acme`; `data-corp.io` → `Data-Corp`; `team.acme.co.uk` → `Acme`. A best-effort
 * default the user can edit before saving (docs/plan §7).
 */
export function deriveOrgNameFromDomain(domain: string): string {
  const labels = domain.trim().toLowerCase().split('.').filter((l) => l !== '');
  if (labels.length === 0) return domain;
  let sldIndex = labels.length - 2;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) sldIndex = labels.length - 3;
  const label = labels[sldIndex] ?? labels[0] ?? domain;
  return label
    .split('-')
    .map((part) => (part === '' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

/** Two-ish-letter initials from an org name (matches the clients-table fallback). */
export function deriveInitialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  const initials = (first + second).toUpperCase();
  if (initials !== '') return initials;
  const fallback = name.trim().slice(0, 2).toUpperCase();
  return fallback !== '' ? fallback : '?';
}
