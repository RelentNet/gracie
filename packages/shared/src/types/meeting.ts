import type {
  MeetingSource,
  MeetingType,
  PipelineStatus,
} from '../constants/enums.js';
import type { ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * One external (non-GA) attendee captured on a meeting (P4.1). The scan persists
 * these to `meetings.external_attendees` because external emails/domains are not
 * otherwise stored (`attendeeUserIds` holds only INTERNAL GA user uuids). They
 * drive domain-based org matching and the "create client from a domain" flow.
 */
export interface ExternalAttendee {
  readonly email: string;
  readonly name: string | null;
  readonly domain: string;
}

/**
 * `meetings` table (docs/04 + P4.1). `clientId` is the denormalized PRIMARY org
 * (nullable; the `meeting_clients` junction is the source of truth for ALL linked
 * orgs). `isInternal` = every attendee is on a GA internal domain. Dedup happens
 * before bot dispatch via `calendarEventId`.
 */
export interface Meeting extends Timestamps {
  readonly id: UUID;
  readonly clientId: UUID | null;
  readonly title: string | null;
  readonly dateTime: ISOTimestamp;
  readonly durationMinutes: number | null;
  readonly meetingType: MeetingType | null;
  readonly meetingLeadUserId: UUID | null;
  readonly attendeeUserIds: readonly UUID[];
  readonly calendarEventId: string | null;
  readonly videoLink: string | null;
  readonly isBotDispatched: boolean;
  readonly botJobId: string | null;
  readonly isTranscriptReceived: boolean;
  readonly isInternal: boolean;
  readonly externalAttendees: readonly ExternalAttendee[];
  readonly pipelineStatus: PipelineStatus;
  readonly pipelineStartedAt: ISOTimestamp | null;
  readonly pipelineCompletedAt: ISOTimestamp | null;
  readonly hasOpenItems: boolean;
  readonly source: MeetingSource;
}

/** `meeting_type_rules` table — keyword → meeting_type classification. */
export interface MeetingTypeRule {
  readonly id: UUID;
  readonly keyword: string;
  readonly meetingType: MeetingType;
  readonly createdByUserId: UUID | null;
  readonly createdAt: ISOTimestamp;
}
