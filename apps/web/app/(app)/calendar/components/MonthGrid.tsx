'use client';

import { AlertTriangle } from 'lucide-react';
import type { CalendarMeeting } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

import { WEEKDAYS, type GridCell } from '../lib/calendar-dates';
import { meetingNeedsAttention } from '../lib/calendar-meeting';
import { MeetingPill } from './MeetingPill';

export function MonthGrid({
  grid,
  meetingsByDay,
  selectedDay,
  onSelect,
  loading,
}: {
  readonly grid: { cells: GridCell[] };
  readonly meetingsByDay: ReadonlyMap<string, CalendarMeeting[]>;
  readonly selectedDay: string;
  readonly onSelect: (key: string) => void;
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-1 py-1 text-center"
            style={{ ...TYPE.label, color: 'var(--text-secondary)' }}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.cells.map((cell) => {
          const dayMeetings = meetingsByDay.get(cell.key) ?? [];
          const isSelected = cell.key === selectedDay;
          const hasAttention = dayMeetings.some(meetingNeedsAttention);
          return (
            <button
              key={cell.key}
              type="button"
              onClick={(): void => onSelect(cell.key)}
              aria-pressed={isSelected}
              className="flex min-h-[4.5rem] flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors"
              style={{
                borderColor: isSelected ? 'var(--color-blue-500)' : 'var(--border-subtle)',
                backgroundColor: isSelected
                  ? 'var(--color-blue-100)'
                  : cell.inMonth
                    ? '#ffffff'
                    : 'var(--color-slate-100)',
                opacity: cell.inMonth ? 1 : 0.6,
                cursor: 'pointer',
              }}
            >
              <span className="flex items-center justify-between">
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
                {hasAttention ? (
                  <AlertTriangle
                    size={12}
                    aria-label="Needs client assignment"
                    style={{ color: 'var(--color-amber-600)' }}
                  />
                ) : null}
              </span>
              {loading ? null : dayMeetings.length > 0 ? (
                <span className="flex flex-col gap-0.5">
                  {dayMeetings.slice(0, 2).map((m) => (
                    <MeetingPill key={m.id} meeting={m} />
                  ))}
                  {dayMeetings.length > 2 ? (
                    <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                      +{dayMeetings.length - 2} more
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
