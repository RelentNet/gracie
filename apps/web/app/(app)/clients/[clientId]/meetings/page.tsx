import Link from 'next/link';
import { CalendarClock } from 'lucide-react';

import type { Meeting } from '@gracie/shared';

import { StateChip } from '@/components/meetings/StateChip';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateViews';
import { getClientMeetings } from '@/lib/data/client-detail';
import { listAssignableUsers } from '@/lib/data/users';
import { formatEasternDateTime } from '@/lib/format';
import { deriveOccurrenceState, splitClientMeetings } from '@/lib/meeting-occurrence';
import { TYPE } from '@/lib/typography';

/**
 * Client tab — Meetings. The 2 nearest upcoming and 6 most-recent previous
 * meetings for this client, each linking to its occurrence page (`/meetings/[id]`).
 * Server component: reads the existing per-client meetings data layer directly
 * (scoped by the primary `client_id`, like the rest of client-detail). Display-only
 * — the `(app)` layout already gates auth and all staff see all clients.
 */
function MeetingRow({
  meeting,
  leadName,
}: {
  readonly meeting: Meeting;
  readonly leadName: string | null;
}): React.JSX.Element {
  return (
    <Link
      href={`/meetings/${meeting.id}`}
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
          {formatEasternDateTime(meeting.dateTime)}
          {leadName !== null ? ` · ${leadName}` : null}
        </span>
      </span>
      <span className="flex-shrink-0">
        <StateChip state={deriveOccurrenceState(meeting)} />
      </span>
    </Link>
  );
}

export default async function ClientMeetingsPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): Promise<React.JSX.Element> {
  const { clientId } = await params;
  const [meetings, users] = await Promise.all([getClientMeetings(clientId), listAssignableUsers()]);
  const { upcoming, previous } = splitClientMeetings(meetings);

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
              <MeetingRow key={m.id} meeting={m} leadName={leadNameOf(m)} />
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
              <MeetingRow key={m.id} meeting={m} leadName={leadNameOf(m)} />
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
