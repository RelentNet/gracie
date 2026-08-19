'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AmbiguousMeeting } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/StateViews';

import { localDayKey } from '../lib/calendar-dates';
import type { AmbiguousResponse } from '../types';

/**
 * Compact pointer to the meetings that still need a client. Assignment itself
 * happens on the day view's meeting card (link an org or create a new client) —
 * this is just the nudge + a jump to the earliest such day, not a second
 * assignment UI. Admin-only (rendered by the page behind calendar.configure).
 */
export function AmbiguousSection({
  onJump,
}: {
  readonly onJump: (dayKey: string) => void;
}): React.JSX.Element | null {
  const [meetings, setMeetings] = useState<readonly AmbiguousMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<AmbiguousResponse>('/api/calendar/ambiguous')
      .then((d) => {
        if (active) setMeetings(d.meetings);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : 'Failed to load meetings needing a client');
      });
    return (): void => {
      active = false;
    };
  }, []);

  if (error !== null) {
    return (
      <Card accent="critical" className="p-6 lg:flex-1">
        <ErrorState title="Couldn’t load meetings needing a client" description={error} />
      </Card>
    );
  }
  // Nothing to nag about (still loading, or all meetings are assigned).
  if (meetings === null || meetings.length === 0) return null;

  const earliest = [...meetings].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime))[0];
  const earliestDay = earliest !== undefined ? localDayKey(earliest.dateTime) : null;

  return (
    <Card accent="critical" className="p-6 lg:flex-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--color-amber-600)' }} />
          <div className="flex flex-col">
            <span style={TYPE.bodyStrong}>
              {meetings.length} meeting{meetings.length === 1 ? '' : 's'} need a client
            </span>
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              Open a meeting on its day to link an org or create a new client.
            </span>
          </div>
        </div>
        {earliestDay !== null ? (
          <Button size="sm" onClick={(): void => onJump(earliestDay)}>
            Go to first →
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
