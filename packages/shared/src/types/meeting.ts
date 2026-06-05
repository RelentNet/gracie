import type {
  MeetingSource,
  MeetingType,
  PipelineStatus,
} from '../constants/enums.js';
import type { ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * `meetings` table (docs/04). `clientId` null = ambiguous/unassigned (resolved
 * by an Admin). Dedup happens before bot dispatch via `calendarEventId`.
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
