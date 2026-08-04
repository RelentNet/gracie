'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import type { AmbiguousResponse } from '../types';

export function AmbiguousSection(): React.JSX.Element {
  const [data, setData] = useState<AmbiguousResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback((): void => {
    setError(null);
    apiClient
      .get<AmbiguousResponse>('/api/calendar/ambiguous')
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load ambiguous meetings'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const assign = useCallback(
    (meetingId: string): void => {
      const clientId = choice[meetingId];
      if (clientId === undefined || clientId === '') return;
      setAssigning(meetingId);
      apiClient
        .post('/api/calendar/assign', { meetingId, clientId })
        .then(() => load())
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to assign client'))
        .finally(() => setAssigning(null));
    },
    [choice, load],
  );

  return (
    <Card accent={data !== null && data.meetings.length > 0 ? 'critical' : 'none'}>
      <CardHeader
        title="Needs client assignment"
        description="Meetings with no linked client or an unrecognized org domain. Assign a client to queue the bot, or create the org from the meeting."
      />
      {error !== null ? (
        <ErrorState title="Couldn’t load" description={error} />
      ) : data === null ? (
        <LoadingState label="Loading…" />
      ) : data.meetings.length === 0 ? (
        <EmptyState title="Nothing to assign" description="No ambiguous meetings. Matches are resolving cleanly." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.meetings.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span style={TYPE.bodyStrong}>{m.title ?? 'Untitled meeting'}</span>
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {formatDateTime(m.dateTime)}
                  {m.attendees.length > 0 ? ` · ${m.attendees.map((p) => p.name).join(', ')}` : ''}
                </span>
                {m.unknownOrgDomains.length > 0 ? (
                  <span className="font-data" style={{ ...TYPE.label, color: 'var(--color-amber-600)' }}>
                    Unknown: {m.unknownOrgDomains.join(', ')}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={choice[m.id] ?? ''}
                  onChange={(event): void => setChoice((prev) => ({ ...prev, [m.id]: event.target.value }))}
                  className="rounded-lg border bg-white px-3 py-2"
                  style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
                  aria-label={`Assign a client to ${m.title ?? 'meeting'}`}
                >
                  <option value="">Select client…</option>
                  {data.clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={assigning === m.id || (choice[m.id] ?? '') === ''}
                  onClick={(): void => assign(m.id)}
                >
                  {assigning === m.id ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
