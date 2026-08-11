/**
 * Response shapes for the calendar API (`GET/POST/PATCH /api/calendar*`).
 * Extracted verbatim from the calendar page.
 */
import type {
  AmbiguousMeeting,
  CalendarMeeting,
  ClientCadenceRow,
  PipelineStatus,
} from '@gracie/shared';

export interface MeetingsResponse {
  readonly meetings: readonly CalendarMeeting[];
}
export interface CadenceResponse {
  readonly cadence: readonly ClientCadenceRow[];
}
export interface AmbiguousResponse {
  readonly meetings: readonly AmbiguousMeeting[];
  readonly clientOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}
export interface ManualJoinStateResponse {
  readonly enabled: boolean;
}
export interface JoinMeetingResponse {
  readonly meeting: {
    readonly meetingId: string;
    readonly title: string;
    readonly dateTime: string;
    readonly botDispatched: boolean;
    readonly pipelineStatus: PipelineStatus;
  };
}
/** One selectable org in the Join-a-meeting client picker. */
export interface JoinOrgOption {
  readonly id: string;
  readonly label: string;
}
