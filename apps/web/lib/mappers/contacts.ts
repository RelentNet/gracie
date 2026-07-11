/**
 * Row mappers for the Contacts & Org Charts feature (phase `CO`) — convert raw
 * Supabase rows (snake_case) to the camelCase domain types in `@gracie/shared`.
 * Mirrors lib/mappers.ts (clients) and lib/mappers/meeting.ts. One place to keep
 * the DB↔domain boundary explicit.
 */
import type { Database, Json } from '@gracie/db';
import type {
  AffiliationView,
  Contact,
  ContactAffiliation,
  ContactSuggestion,
  ContactSuggestionStatus,
  Office,
} from '@gracie/shared';
import type { ClientType } from '@gracie/shared';

type ContactRow = Database['public']['Tables']['contacts']['Row'];
type OfficeRow = Database['public']['Tables']['offices']['Row'];
type AffiliationRow = Database['public']['Tables']['contact_affiliations']['Row'];
type SuggestionRow = Database['public']['Tables']['contact_suggestions']['Row'];

export function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOffice(row: OfficeRow): Office {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    parentOfficeId: row.parent_office_id,
    description: row.description,
    isKey: row.is_key,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAffiliation(row: AffiliationRow): ContactAffiliation {
  return {
    id: row.id,
    contactId: row.contact_id,
    clientId: row.client_id,
    officeId: row.office_id,
    title: row.title,
    orgEmail: row.org_email,
    orgPhone: row.org_phone,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    isCurrent: row.is_current,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * An affiliation row with its embedded org (`clients`), office, and contact joined
 * in — the shape returned by the enriched `select('*, clients(...), offices(...),
 * contacts(...)')` queries. Embeds are cast defensively (mirrors calendar.ts).
 */
export interface AffiliationRowWithJoins extends AffiliationRow {
  readonly clients?: { name: string; type: ClientType } | null;
  readonly offices?: { title: string } | null;
  readonly contacts?: { full_name: string; email: string | null; phone: string | null } | null;
}

/** Map an enriched affiliation row (with org/office/contact embeds) to the view model. */
export function mapAffiliationView(row: AffiliationRowWithJoins): AffiliationView {
  const org = (row.clients ?? null) as { name: string; type: ClientType } | null;
  const office = (row.offices ?? null) as { title: string } | null;
  const contact = (row.contacts ?? null) as
    | { full_name: string; email: string | null; phone: string | null }
    | null;
  return {
    ...mapAffiliation(row),
    contactName: contact?.full_name ?? '',
    contactEmail: contact?.email ?? null,
    contactPhone: contact?.phone ?? null,
    orgName: org?.name ?? '',
    orgType: org?.type ?? 'client',
    officeTitle: office?.title ?? null,
  };
}

/** Coerce a raw jsonb `payload` into a plain object (defensive against non-objects). */
function coercePayload(value: Json): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

/** Coerce a raw `status` string to the typed union (defaults to 'pending'). */
function coerceStatus(value: string): ContactSuggestionStatus {
  return value === 'accepted' || value === 'dismissed' ? value : 'pending';
}

export function mapSuggestion(row: SuggestionRow): ContactSuggestion {
  return {
    id: row.id,
    source: row.source,
    suggestedName: row.suggested_name,
    suggestedEmail: row.suggested_email,
    suggestedDomain: row.suggested_domain,
    clientId: row.client_id,
    officeId: row.office_id,
    meetingId: row.meeting_id,
    payload: coercePayload(row.payload),
    status: coerceStatus(row.status),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
  };
}
