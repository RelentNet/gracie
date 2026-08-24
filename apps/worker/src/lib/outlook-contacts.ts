/**
 * Pure mapping + dedupe helpers for the Outlook/Office 365 contacts import
 * (`import-outlook-contacts.processor.ts`). No DB / Graph I/O here so the
 * field-mapping and the dedupe decision are unit-testable in isolation.
 *
 * Mapping (MS Graph contact → Gracie contact):
 *   displayName                        → name  (falls back to the email when blank)
 *   emailAddresses[0].address          → email (the dedupe key)
 *   mobilePhone || businessPhones[0]    → phone
 *   jobTitle                           → title
 *   companyName                        → company
 *
 * Dedupe: keyed by lower-cased email. A contact with no email is SKIPPED (we do
 * not fuzzy-match on name+company — too error-prone for an unattended import). An
 * existing contact with the same email is UPDATED to fill only its still-empty
 * fields (never overwriting a value a human may have edited); when nothing is
 * missing the import is a no-op (idempotent re-runs).
 */
import type { GraphContactRaw } from './graph.js';

/** A Graph contact mapped to Gracie fields. `email` is always present + trimmed. */
export interface MappedContact {
  /** Never empty — display name, or the email when Outlook has no display name. */
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly title: string | null;
  readonly company: string | null;
}

/** Trim to a non-empty string, or null. */
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Map one raw Graph contact to Gracie fields, or null when it has no usable email
 * (skipped — email is the dedupe key). `name` falls back to the email so the
 * NOT-NULL `contacts.full_name` always has a value.
 */
export function mapGraphContact(raw: GraphContactRaw): MappedContact | null {
  const email = clean(raw.emailAddresses?.find((e) => clean(e.address) !== null)?.address);
  if (email === null) return null;
  const phone = clean(raw.mobilePhone) ?? clean(raw.businessPhones?.[0]);
  return {
    name: clean(raw.displayName) ?? email,
    email,
    phone,
    title: clean(raw.jobTitle),
    company: clean(raw.companyName),
  };
}

/** The subset of an existing `contacts` row the dedupe decision reads. */
export interface ExistingContact {
  readonly id: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly title: string | null;
  readonly company: string | null;
  readonly source: string | null;
}

/** Only the columns an import ever writes/fills on `contacts`. */
export interface ContactWriteFields {
  readonly full_name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly title: string | null;
  readonly company: string | null;
  readonly source: string;
}

export type ContactUpsertDecision =
  | { readonly action: 'insert'; readonly row: ContactWriteFields }
  | { readonly action: 'update'; readonly id: string; readonly patch: Partial<ContactWriteFields> }
  | { readonly action: 'skip'; readonly id: string };

/**
 * Decide how to apply one mapped contact given the existing contact with the same
 * email (or null). Insert when absent; otherwise fill only the existing row's
 * empty fields (fill-not-overwrite) and skip when nothing is missing.
 */
export function decideContactUpsert(
  existing: ExistingContact | null,
  mapped: MappedContact,
  source: string,
): ContactUpsertDecision {
  if (existing === null) {
    return {
      action: 'insert',
      row: {
        full_name: mapped.name,
        email: mapped.email,
        phone: mapped.phone,
        title: mapped.title,
        company: mapped.company,
        source,
      },
    };
  }
  const patch: { -readonly [K in keyof ContactWriteFields]?: ContactWriteFields[K] } = {};
  if (isBlank(existing.full_name) && mapped.name !== '') patch.full_name = mapped.name;
  if (isBlank(existing.phone) && mapped.phone !== null) patch.phone = mapped.phone;
  if (isBlank(existing.title) && mapped.title !== null) patch.title = mapped.title;
  if (isBlank(existing.company) && mapped.company !== null) patch.company = mapped.company;
  if (isBlank(existing.source)) patch.source = source;
  return Object.keys(patch).length === 0
    ? { action: 'skip', id: existing.id }
    : { action: 'update', id: existing.id, patch };
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}
