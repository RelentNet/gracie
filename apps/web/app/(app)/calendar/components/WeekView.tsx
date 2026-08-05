'use client';

import { AlertTriangle } from 'lucide-react';
import type { CalendarMeeting } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

import { WEEKDAYS, type GridCell } from '../lib/calendar-dates';
import { meetingNeedsAttention } from '../lib/calendar-meeting';
import { MeetingPill } from './MeetingPill';

/**
 * The 7 days of the selected week as columns (desktop) that stack into rows on
 * mobile. Each day lists all its meetings (reusing the month grid's `MeetingPill`)
 * and is itself the day selector — clicking a column opens the shared DayDetail.
 */
export function WeekView({
  cells,
  meetingsByDay,
  selectedDay,
  onSelect,
  loading,
}: {
  readonly cells: readonly GridCell[];
  readonly meetingsByDay: ReadonlyMap<string, CalendarMeeting[]>;
  readonly selectedDay: string;
  readonly onSelect: (key: string) => void;
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-7">
      {cells.map((cell, i) => {
        const dayMeetings = [...(meetingsByDay.get(cell.key) ?? [])].sort(
          (a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime),
        );
        const isSelected = cell.key === selectedDay;
        const hasAttention = dayMeetings.some(meetingNeedsAttention);
        return (
          <button
            key={cell.key}
            type="button"
            onClick={(): void => onSelect(cell.key)}
            aria-pressed={isSelected}
            className="flex min-h-[8rem] flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors"
            style={{
              borderColor: isSelected ? 'var(--color-blue-500)' : 'var(--border-subtle)',
              backgroundColor: isSelected ? 'var(--color-blue-100)' : 'var(--color-white)',
              cursor: 'pointer',
            }}
          >
            <span className="flex items-center justify-between">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{WEEKDAYS[i]}</span>
              <span className="flex items-center gap-1">
                {hasAttention ? (
                  <AlertTriangle
                    size={12}
                    aria-label="Needs client assignment"
                    style={{ color: 'var(--color-amber-600)' }}
                  />
                ) : null}
                <span
                  className="inline-flex size-6 items-center justify-center rounded-full"
                  style={{
                    ...TYPE.secondary,
                    fontWeight: cell.isToday ? 700 : 500,
                    backgroundColor: cell.isToday ? 'var(--color-blue-500)' : 'transparent',
                    color: cell.isToday ? '#ffffff' : 'var(--text-primary)',
                  }}
                >
                  {cell.dayOfMonth}
                </span>
              </span>
            </span>
            {loading ? null : dayMeetings.length > 0 ? (
              <span className="flex flex-col gap-0.5">
                {dayMeetings.map((m) => (
                  <MeetingPill key={m.id} meeting={m} />
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
