/**
 * Calendar view-model contracts (P4, docs/08 §M7). These are the enriched,
 * presentation-facing shapes returned by the `GET /api/calendar*` routes and
 * consumed by the Calendar UI — DB ids are resolved to display names/initials at
 * the data layer so the client renders without a second lookup.
 *
 * PURE / client-safe (no server-only import): the web data layer builds these and
 * the client page imports the types. Distinct from the raw `Meeting` domain type
 * (types/meeting.ts), which mirrors the DB row.
 */
import type { ClientType, MeetingSource, MeetingType, PipelineStatus } from '../constants/enums.js';
import type { ClientCadence } from '../constants/enums.js';
import type { ExternalAttendee } from './meeting.js';
import type { ISOTimestamp, UUID } from './common.js';

/** A person on a meeting who maps to a GA App user (by email). */
export interface CalendarPerson {
  readonly id: UUID;
  readonly name: string;
  readonly initials: string;
}

/** A linked org (from the `meeting_clients` junction) shown as a chip. */
export interface MeetingOrg {
  readonly id: UUID;
  readonly name: string;
  readonly type: ClientType;
}

/**
 * A meeting enriched for the month grid + day detail (P4.1: meetings-first).
 *
 * EVERY real meeting is surfaced — not just client-matched ones. A meeting's
 * org(s) come from the `orgs` junction (multi-client is 2+). `isInternal` tags a
 * GA-only meeting. `unknownOrgDomains` are external domains with no org yet
 * (offer "create client / lead" — computed at read time so it stays correct as
 * orgs get created). `clientId`/`clientName` mirror the denormalized PRIMARY org.
 */
export interface CalendarMeeting {
  readonly id: UUID;
  readonly clientId: UUID | null;
  readonly clientName: string | null;
  readonly title: string | null;
  readonly dateTime: ISOTimestamp;
  readonly durationMinutes: number | null;
  readonly meetingType: MeetingType | null;
  readonly videoLink: string | null;
  readonly pipelineStatus: PipelineStatus;
  readonly isBotDispatched: boolean;
  readonly isInternal: boolean;
  readonly source: MeetingSource;
  readonly lead: CalendarPerson | null;
  readonly attendees: readonly CalendarPerson[];
  readonly orgs: readonly MeetingOrg[];
  readonly externalAttendees: readonly ExternalAttendee[];
  readonly unknownOrgDomains: readonly string[];
}

/**
 * A meeting needing attention for the Admin assignment list (P4.1): no linked
 * client-type org yet, or an external domain with no org. Includes the GA
 * attendees (who's on it) plus any `unknownOrgDomains` so the Admin can assign an
 * existing client or spin up a new org from the surfaced domain.
 */
export interface AmbiguousMeeting {
  readonly id: UUID;
  readonly title: string | null;
  readonly dateTime: ISOTimestamp;
  readonly videoLink: string | null;
  readonly attendees: readonly CalendarPerson[];
  readonly unknownOrgDomains: readonly string[];
}

/** One row of the calendar connection panel (= access-group membership, D5). */
export interface CalendarConnection {
  readonly userId: UUID;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly isConnected: boolean;
}

/**
 * Connection-status response. `self` is always the caller's own row; `members`
 * is the full team list for Admins and a single-element list (self) otherwise
 * (docs/05: "Admin sees all; user sees own").
 */
export interface CalendarConnectionStatus {
  /** Whether `MS_CALENDAR_GROUP_ID` is configured on the worker (scan can run). */
  readonly groupConfigured: boolean;
  /** ISO timestamp of the last completed scan sync, or null if never run. */
  readonly lastSyncedAt: ISOTimestamp | null;
  readonly self: CalendarConnection | null;
  readonly members: readonly CalendarConnection[];
}

/** One row of the per-client cadence tracker (last/next meeting + overdue). */
export interface ClientCadenceRow {
  readonly clientId: UUID;
  readonly clientName: string;
  readonly cadence: ClientCadence;
  readonly lastMeetingAt: ISOTimestamp | null;
  readonly nextMeetingAt: ISOTimestamp | null;
  /** True when the cadence interval has lapsed with no upcoming meeting scheduled. */
  readonly isOverdue: boolean;
}
