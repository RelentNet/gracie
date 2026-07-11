/**
 * Resend email adapter (P7, docs/07 §7) — the SINGLE outbound-email choke-point.
 *
 * ⚠️ HARD SAFETY RULE (docs/plan p7 §3): Gracie may ONLY ever send email to
 * `@graceandassociates.com` recipients — internal/team email only, in any
 * capacity. This is enforced STRUCTURALLY here: every send goes through
 * {@link sendEmail}, which filters every recipient against the allowlist BEFORE
 * calling Resend, drops + logs the rest, and no-ops (never calls Resend) when no
 * allowed recipient remains. No processor may call the Resend API directly.
 *
 * The allowlist domains come from `settings.email_allowed_domains` (seeded default
 * `graceandassociates.com`, comma-separated). This is deliberately SEPARATE from
 * `internal_email_domains` (which includes the `onmicrosoft` routing domain — a
 * real tenant domain but NOT a mailbox; we must never email it).
 *
 * Dependency-free `fetch` (no SDK), mirroring `recall.ts`; throw-on-non-OK so
 * BullMQ retries transient failures. The pure allowlist helpers
 * ({@link parseAllowedDomains}, {@link filterAllowedRecipients}) carry no I/O so
 * they are unit-testable in isolation (see `resend.test.ts`).
 */
import { getCredential, getServerClient } from '@gracie/db';

/** The Resend transactional-email endpoint. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The safety FLOOR applied when `settings.email_allowed_domains` is unset or parses
 * empty — Gracie still only ever emails Grace & Associates. Never widen this to a
 * non-GA domain (§3: escalate instead of relaxing the allowlist).
 */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ['graceandassociates.com'];

/** Settings key holding the comma-separated allowlist (JSON string). */
const ALLOWED_DOMAINS_SETTING_KEY = 'email_allowed_domains';

/** Minimal structured logger (a subset of Fastify's logger) the adapter needs. */
export interface EmailLogger {
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
}

/** The lowercased mail domain of an address (after the LAST `@`), or null. */
export function addressDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain === '' ? null : domain;
}

/**
 * Parse the `email_allowed_domains` setting value into a normalized domain set.
 * Accepts a comma-separated string (the stored JSON-string format, matching
 * `internal_email_domains`); tolerates whitespace, casing, and empty entries.
 * Returns an EMPTY set for null/blank input — callers apply the default floor.
 */
export function parseAllowedDomains(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== 'string') return out;
  for (const part of raw.split(',')) {
    const domain = part.trim().toLowerCase();
    if (domain !== '') out.add(domain);
  }
  return out;
}

/** Result of splitting a recipient list by the allowlist. */
export interface RecipientFilterResult {
  /** Recipients whose domain is on the allowlist — safe to send. */
  readonly allowed: string[];
  /** Recipients dropped because their domain is NOT allowlisted. */
  readonly dropped: string[];
}

/**
 * Pure allowlist filter (the §3 guard). Keeps only recipients whose domain
 * (case-insensitive, after the last `@`) is in `allowedDomains`; everything else
 * — including malformed addresses with no domain — is dropped. Fail-closed: an
 * empty `allowedDomains` drops every recipient.
 */
export function filterAllowedRecipients(
  to: readonly string[],
  allowedDomains: ReadonlySet<string>,
): RecipientFilterResult {
  const allowed: string[] = [];
  const dropped: string[] = [];
  for (const raw of to) {
    const address = raw.trim();
    if (address === '') continue;
    const domain = addressDomain(address);
    if (domain !== null && allowedDomains.has(domain)) allowed.push(address);
    else dropped.push(address);
  }
  return { allowed, dropped };
}

/** Load the effective allowlist from settings, applying the default floor. */
async function loadAllowedDomains(): Promise<Set<string>> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', ALLOWED_DOMAINS_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`sendEmail: load ${ALLOWED_DOMAINS_SETTING_KEY}: ${error.message}`);
  const raw = typeof data?.value === 'string' ? data.value : null;
  const parsed = parseAllowedDomains(raw);
  // A missing / misconfigured (empty) setting falls back to the GA floor rather
  // than silently disabling ALL email — but never widens beyond GA.
  return parsed.size > 0 ? parsed : new Set(DEFAULT_ALLOWED_DOMAINS);
}

/** The content of one outbound email. */
export interface SendEmailInput {
  /** From address — must be on the Resend-verified domain (`RESEND_FROM`, §7). */
  readonly from: string;
  /** Intended recipients — filtered against the allowlist before any send. */
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  /** Optional plain-text alternative (recommended for deliverability). */
  readonly text?: string;
  /**
   * The customer-contact EXCEPTION (P8 §2b). Addresses here — and ONLY these — are
   * permitted to receive this email even though they are NOT on the GA allowlist.
   * The caller must have already gated this on ALL of: an explicitly user-initiated
   * automation, the `automations_external_send_enabled` admin master switch, an
   * `automations.externalSend` (admin) confirmer, and an explicit extra confirmation
   * — and MUST audit the delivered externals into `automation_runs.external_recipients`.
   *
   * Mechanism (never a second email path): the allowlist filter stays pure; this set
   * merely rescues matching addresses from `dropped` into the send. Anything not in
   * this set is still dropped — the GA floor holds for every other recipient.
   */
  readonly approvedExternalRecipients?: readonly string[];
}

/** Injectable dependencies for {@link sendEmail} (all optional; real defaults). */
export interface SendEmailDeps {
  readonly logger: EmailLogger;
  /** Override the Resend key (else resolved via `getCredential('resend')`). */
  readonly apiKey?: string | null;
  /** Override the allowlist (else `settings.email_allowed_domains` + floor). */
  readonly allowedDomains?: ReadonlySet<string>;
  /** Override `fetch` (tests inject a stub so no network is touched). */
  readonly fetchImpl?: typeof fetch;
}

/** Outcome of a {@link sendEmail} call. */
export interface SendEmailResult {
  /** The Resend message id, or null when the send was skipped (no allowed recipient). */
  readonly id: string | null;
  /** Recipients the email was actually sent to (allowlisted + approved externals). */
  readonly delivered: string[];
  /** Recipients dropped by the allowlist (excludes any approved externals). */
  readonly dropped: string[];
  /**
   * Externals delivered under the §2b customer-contact exception — the caller MUST
   * write these to `automation_runs.external_recipients` for audit. Empty for every
   * normal (internal-only) send.
   */
  readonly externalDelivered: string[];
}

/**
 * THE outbound-email choke-point. Applies the allowlist (§3), then POSTs to
 * Resend for the surviving recipients only. Never calls Resend when zero
 * recipients remain (logs a skip). Throws on a non-OK Resend response so BullMQ
 * retries transient failures.
 */
export async function sendEmail(
  input: SendEmailInput,
  deps: SendEmailDeps,
): Promise<SendEmailResult> {
  const { logger } = deps;
  const allowedDomains = deps.allowedDomains ?? (await loadAllowedDomains());
  const filtered = filterAllowedRecipients(input.to, allowedDomains);
  const allowed = filtered.allowed;

  // §2b customer-contact exception: rescue ONLY the explicitly-approved externals
  // from the dropped set. Everything else stays dropped — the GA floor is intact.
  const approvedSet = new Set(
    (input.approvedExternalRecipients ?? [])
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a !== ''),
  );
  const approvedExternal: string[] = [];
  const dropped: string[] = [];
  for (const recipient of filtered.dropped) {
    if (approvedSet.has(recipient.trim().toLowerCase())) approvedExternal.push(recipient);
    else dropped.push(recipient);
  }

  for (const recipient of dropped) {
    logger.warn(
      { recipient, subject: input.subject, allowedDomains: [...allowedDomains] },
      'sendEmail: dropped non-allowlisted recipient (internal/team email only)',
    );
  }
  for (const recipient of approvedExternal) {
    logger.warn(
      { recipient, subject: input.subject },
      'sendEmail: EXTERNAL recipient approved under the customer-contact exception (audited)',
    );
  }

  const finalRecipients = [...allowed, ...approvedExternal];
  if (finalRecipients.length === 0) {
    logger.info(
      { subject: input.subject, droppedCount: dropped.length },
      'sendEmail: no allowlisted recipients — skipping Resend send',
    );
    return { id: null, delivered: [], dropped, externalDelivered: [] };
  }

  const apiKey = deps.apiKey ?? (await getCredential('resend'));
  if (apiKey === null || apiKey === '') {
    throw new Error('sendEmail: no Resend API key configured (Admin → API Settings / RESEND_API_KEY).');
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: finalRecipients,
      subject: input.subject,
      html: input.html,
      ...(input.text !== undefined ? { text: input.text } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`sendEmail: Resend rejected the send (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string };
  logger.info(
    { id: data.id ?? null, delivered: finalRecipients.length, dropped: dropped.length, external: approvedExternal.length },
    'sendEmail: sent',
  );
  return { id: data.id ?? null, delivered: finalRecipients, dropped, externalDelivered: approvedExternal };
}
