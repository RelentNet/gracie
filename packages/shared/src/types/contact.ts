/**
 * Contacts & Org Charts domain contracts (phase `CO`, docs/plan/contacts-org-charts.md).
 *
 * PURE / client-safe (no server-only import): the web data/API layer builds these
 * from raw Supabase rows (via mappers) and both the API responses and the client
 * pages import the types. Mirrors the pattern of types/client.ts + types/calendar.ts.
 *
 * Model (locked with the operator):
 *  - "Org" = a `clients` row of ANY type (client/prospect/lead/partner/internal, P4.1).
 *  - Offices are FIRST-CLASS org-chart nodes (per org, reports-to parent) and CAN BE VACANT.
 *  - Contacts are people; they fill offices via AFFILIATIONS that carry tenure history
 *    and allow MULTIPLE orgs (someone moving VA → a client over time keeps both).
 */
import type { ClientType } from '../constants/enums.js';
import type { ISODate, ISOTimestamp, Timestamps, UUID } from './common.js';

// --- Base row types (mirror the 0008 tables) --------------------------------------

/** `contacts` table — a person, org-agnostic (linked to orgs via affiliations). */
export interface Contact extends Timestamps {
  readonly id: UUID;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly linkedinUrl: string | null;
  readonly notes: string | null;
  readonly createdByUserId: UUID | null;
}

/**
 * `offices` table — an org-chart NODE: an office/position that belongs to an org,
 * reports to a parent office (the hierarchy), and can be VACANT (no current holder).
 */
export interface Office extends Timestamps {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly title: string;
  /** Reports-to parent office (null = a root of the org chart). */
  readonly parentOfficeId: UUID | null;
  readonly description: string | null;
  /** Flag an important office to watch — especially when it goes vacant. */
  readonly isKey: boolean;
  readonly sortOrder: number;
}

/**
 * `contact_affiliations` table — a contact ↔ org link (+ optional formal office) with
 * a tenure (`startedOn`/`endedOn`) and an app-maintained `isCurrent` flag. A contact
 * may hold several CURRENT affiliations across different orgs; at most one current
 * holder per office is enforced by a partial unique index (the vacant/filled invariant).
 */
export interface ContactAffiliation extends Timestamps {
  readonly id: UUID;
  readonly contactId: UUID;
  readonly clientId: UUID;
  /** Formal office filled by this affiliation, or null for a freeform-title role. */
  readonly officeId: UUID | null;
  /** Freeform title when there's no modeled office. */
  readonly title: string | null;
  readonly orgEmail: string | null;
  readonly orgPhone: string | null;
  readonly startedOn: ISODate | null;
  /** Null = ongoing. Set (with `isCurrent=false`) when the person leaves/moves. */
  readonly endedOn: ISODate | null;
  readonly isCurrent: boolean;
  readonly notes: string | null;
}

/** Lifecycle of a suggestion in the inbox. */
export type ContactSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

/**
 * `contact_suggestions` table — a source-agnostic inbox of people to add. Fed today
 * by the calendar-attendee scan (`source='calendar_attendee'`) and, later, by an n8n
 * web-scan (`source='n8n_web'`) that targets a specific vacant `officeId`.
 */
export interface ContactSuggestion {
  readonly id: UUID;
  readonly source: string;
  readonly suggestedName: string | null;
  readonly suggestedEmail: string | null;
  readonly suggestedDomain: string | null;
  /** Guessed org (by domain), or null when unknown / free-email. */
  readonly clientId: UUID | null;
  /** A vacant office this suggestion proposes filling (n8n web-scan), or null. */
  readonly officeId: UUID | null;
  /** Provenance for the calendar source. */
  readonly meetingId: UUID | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: ContactSuggestionStatus;
  readonly createdAt: ISOTimestamp;
  readonly resolvedAt: ISOTimestamp | null;
  readonly resolvedByUserId: UUID | null;
}

// --- Enriched view models (returned by the API, consumed by the UI) ----------------

/**
 * An affiliation enriched with display names for the org + office + contact, so the
 * contact profile (history grouped by org) and the org roster render without a second
 * lookup. Distinct from the raw {@link ContactAffiliation}.
 */
export interface AffiliationView extends ContactAffiliation {
  readonly contactName: string;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly orgName: string;
  readonly orgType: ClientType;
  /** Title of the linked formal office (null for a freeform-title affiliation). */
  readonly officeTitle: string | null;
}

/**
 * A contact plus its affiliations (current + optionally past). Returned by the list
 * (current-only) and the profile (full history). The list uses the current
 * affiliations for the org chips; the profile groups them by org.
 */
export interface ContactWithAffiliations extends Contact {
  readonly affiliations: readonly AffiliationView[];
}

/** The current holder of an office (the org-chart node's filled state). */
export interface OfficeHolder {
  readonly affiliationId: UUID;
  readonly contactId: UUID;
  readonly contactName: string;
  readonly startedOn: ISODate | null;
}

/** An office enriched with its current holder — a flat org-chart node (no children). */
export interface OfficeWithHolder extends Office {
  /** Current holder, or null when the office is VACANT. */
  readonly holder: OfficeHolder | null;
}

/** A recursive org-chart node: an office + current holder + its child offices. */
export interface OfficeTreeNode extends OfficeWithHolder {
  readonly children: readonly OfficeTreeNode[];
}

/**
 * The visual org chart for one org: the reports-to tree (`roots`, each node carrying
 * its holder + nested children) plus a flat holder-enriched list (`offices`) for the
 * reports-to picker, counts, and key-vacancy flags.
 */
export interface OrgChart {
  readonly clientId: UUID;
  readonly roots: readonly OfficeTreeNode[];
  readonly offices: readonly OfficeWithHolder[];
}

/** A suggestion enriched with the guessed org + source-meeting titles, for the inbox. */
export interface ContactSuggestionView extends ContactSuggestion {
  readonly orgName: string | null;
  readonly meetingTitle: string | null;
}
