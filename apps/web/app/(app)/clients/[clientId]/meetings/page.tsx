import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CalendarClock } from 'lucide-react';

import type { Meeting } from '@gracie/shared';

import { StateChip } from '@/components/meetings/StateChip';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatEasternDateTime } from '@/lib/format';
import { deriveOccurrenceState, splitClientMeetings } from '@/lib/meeting-occurrence';
import { TYPE } from '@/lib/typography';

/**
 * Client tab — Meetings. The 2 nearest upcoming and 6 most-recent previous
 * meetings for this client, each linking to its occurrence page (`/meetings/[id]`).
 * Reads GET /api/clients/:clientId/meetings (scoped by the primary `client_id`, like
 * the rest of client-detail). Display-only — all staff see all clients.
 */
function MeetingRow({
  meeting,
  leadName,
  timeZone,
}: {
  readonly meeting: Meeting;
  readonly leadName: string | null;
  readonly timeZone?: string | null;
}): React.JSX.Element {
  return (
    <Link
      to={`/meetings/${meeting.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:underline"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span style={TYPE.bodyStrong} className="truncate">
          {meeting.title ?? 'Untitled meeting'}
        </span>
        <span
          className="flex flex-wrap items-center gap-1.5"
          style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
        >
          <CalendarClock size={14} aria-hidden="true" />
          {formatEasternDateTime(meeting.dateTime, timeZone)}
          {leadName !== null ? ` · ${leadName}` : null}
        </span>
      </span>
      <span className="flex-shrink-0">
        <StateChip state={deriveOccurrenceState(meeting)} />
      </span>
    </Link>
  );
}

interface LoadedData {
  readonly meetings: readonly Meeting[];
  readonly users: readonly { readonly id: string; readonly name: string }[];
}

export default function ClientMeetingsPage(): React.JSX.Element {
  const { clientId } = useParams() as { clientId: string };
  const { user: viewer } = useAuth();
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    Promise.all([
      apiClient.get<{ meetings: Meeting[] }>(`/api/clients/${clientId}/meetings`),
      apiClient.get<{ users: LoadedData['users'] }>('/api/users'),
    ])
      .then(([m, u]) => setData({ meetings: m.meetings, users: u.users }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load meetings.'));
  }, [clientId]);
  if (error !== null) return <ErrorState title="Could not load meetings" description={error} />;
  if (data === null) return <LoadingState />;

  const { meetings, users } = data;
  const { upcoming, previous } = splitClientMeetings(meetings);
  const timeZone = viewer.timezone;

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const leadNameOf = (m: Meeting): string | null =>
    m.meetingLeadUserId !== null ? nameById.get(m.meetingLeadUserId) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Upcoming" description="The next meetings scheduled with this client." />
        {upcoming.length > 0 ? (
          <div className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <MeetingRow key={m.id} meeting={m} leadName={leadNameOf(m)} timeZone={timeZone} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No upcoming meetings"
            description="Nothing is scheduled with this client yet."
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Previous" description="The most recent meetings on file." />
        {previous.length > 0 ? (
          <div className="flex flex-col gap-2">
            {previous.map((m) => (
              <MeetingRow key={m.id} meeting={m} leadName={leadNameOf(m)} timeZone={timeZone} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No past meetings on file"
            description="Recorded meetings will appear here."
          />
        )}
      </Card>
    </div>
  );
}
