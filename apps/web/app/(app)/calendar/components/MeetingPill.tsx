'use client';

import type { CalendarMeeting } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

import { localTime } from '../lib/calendar-dates';
import { meetingGridLabel, meetingNeedsAttention } from '../lib/calendar-meeting';

/**
 * One meeting rendered as a compact colored pill (time + org caption). Shared by
 * the month grid and the week view so both stay visually identical.
 */
export function MeetingPill({ meeting }: { readonly meeting: CalendarMeeting }): React.JSX.Element {
  const attention = meetingNeedsAttention(meeting);
  const bg = attention
    ? 'var(--color-amber-100)'
    : meeting.isInternal
      ? 'var(--color-slate-100)'
      : 'var(--color-blue-100)';
  const fg = attention
    ? 'var(--color-amber-600)'
    : meeting.isInternal
      ? 'var(--color-slate-600)'
      : 'var(--color-blue-700)';
  return (
    <span className="truncate rounded px-1" style={{ ...TYPE.label, backgroundColor: bg, color: fg }}>
      {localTime(meeting.dateTime)} {meetingGridLabel(meeting)}
    </span>
  );
}
