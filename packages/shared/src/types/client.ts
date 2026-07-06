import type {
  ClientCadence,
  ClientType,
  FeeTier,
  RelationshipTrend,
} from '../constants/enums.js';
import type { ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * `clients` table (docs/04). `feeTier` and `contractValue` are ADMIN-ONLY data
 * (RLS + API gate); they are omitted from responses for non-admin roles, not
 * merely hidden in the UI.
 */
export interface Client extends Timestamps {
  readonly id: UUID;
  readonly name: string;
  /** Party type (P4.1): client | prospect | lead | partner | internal. */
  readonly type: ClientType;
  readonly initials: string;
  readonly contractNumber: string | null;
  readonly primaryContact: string | null;
  readonly primaryContactEmail: string | null;
  readonly cadence: ClientCadence;
  /** ADMIN-ONLY. */
  readonly feeTier: FeeTier | null;
  /** ADMIN-ONLY. */
  readonly contractValue: number | null;
  readonly billingCadence: string | null;
  /** Used in AI prompts (5-layer chain, layer 2). */
  readonly description: string | null;
  readonly relationshipHealth: number | null;
  readonly relationshipTrend: RelationshipTrend | null;
  readonly lastMeetingAt: ISOTimestamp | null;
  readonly driveFolderUrl: string | null;
}

/** `client_aliases` table — calendar fuzzy matching. */
export interface ClientAlias {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly alias: string;
  readonly createdAt: ISOTimestamp;
}

/**
 * `client_domains` table (P4.1) — the domain→org match key. A domain maps to
 * exactly one org (globally unique, case-insensitive); a meeting attendee on that
 * domain links the meeting to the org.
 */
export interface ClientDomain {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly domain: string;
  readonly createdAt: ISOTimestamp;
}

/** `client_notes` table — Notes tab feed. */
export interface ClientNote extends Timestamps {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly authorUserId: UUID | null;
  readonly content: string;
}

/** `master_record_entries` table — chronological per-client summary log. */
export interface MasterRecordEntry {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly meetingId: UUID | null;
  readonly summary: string;
  readonly createdAt: ISOTimestamp;
}
