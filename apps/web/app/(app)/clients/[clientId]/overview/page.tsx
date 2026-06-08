'use client';

import { use } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import type { Task } from '@gracie/shared';

import {
  getClientById,
  getLatestMeetingForClient,
  getTasksByClient,
  getUserName,
} from '@/lib/mock';
import { TYPE } from '@/lib/typography';
import { formatEasternDateTime } from '@/lib/format';
import { healthColor, healthLabel, priorityBadge, taskStatusLabel } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';

/**
 * Client tab 1 — Overview (docs/08 §9). Relationship health card, last-meeting
 * snapshot, top-3 open tasks, an editable-looking description, and the Drive
 * quick-link. All data via MOCK selectors (Phase 1B-safe).
 */
export default function ClientOverviewPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const client = getClientById(clientId);

  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  const latestMeeting = getLatestMeetingForClient(clientId);
  const openTasks: readonly Task[] = getTasksByClient(clientId)
    .filter((task) => task.status !== 'complete' && !task.isArchived)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Relationship health */}
        <Card style={{ borderTop: `3px solid ${healthColor(client.relationshipHealth)}` }}>
          <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Relationship Health</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span style={{ ...TYPE.pageTitle, color: healthColor(client.relationshipHealth) }}>
              {client.relationshipHealth ?? '—'}
            </span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>/ 100</span>
          </p>
          <p className="mt-1" style={{ ...TYPE.secondary, color: healthColor(client.relationshipHealth) }}>
            {healthLabel(client.relationshipHealth)}
          </p>
        </Card>

        {/* Last meeting snapshot */}
        <Card className="p-6 lg:col-span-2">
          <CardHeader title="Last Meeting" />
          {latestMeeting === undefined ? (
            <EmptyState
              title="No meetings yet"
              description="Scheduled and completed meetings for this client will appear here."
            />
          ) : (
            <div className="flex flex-col gap-1">
              <p style={TYPE.bodyStrong}>{latestMeeting.title ?? 'Untitled meeting'}</p>
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {formatEasternDateTime(latestMeeting.dateTime)}
                {latestMeeting.durationMinutes !== null
                  ? ` · ${latestMeeting.durationMinutes} min`
                  : null}
              </p>
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                Led by {getUserName(latestMeeting.meetingLeadUserId)} ·{' '}
                {latestMeeting.attendeeUserIds.length} attendees
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Top open tasks */}
      <Card>
        <CardHeader title="Top Open Tasks" description="The three highest-priority open items." />
        {openTasks.length === 0 ? (
          <EmptyState
            title="No open tasks"
            description="There are no open tasks for this client right now."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {openTasks.map((task) => {
              const badge = priorityBadge(task.hasPriorityFlag);
              return (
                <li
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate" style={TYPE.body}>
                      {task.description}
                    </span>
                    <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                      {getUserName(task.ownerUserId)} · {taskStatusLabel(task.status)}
                    </span>
                  </div>
                  <Badge bg={badge.bg} fg={badge.fg}>
                    {badge.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Description + Drive link */}
      <Card>
        <CardHeader
          title="Description"
          description="Used as context in AI generation (5-layer prompt)."
          action={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
              style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', cursor: 'pointer', background: 'transparent' }}
            >
              <Pencil aria-hidden="true" size={14} />
              Edit
            </button>
          }
        />
        {client.description !== null ? (
          <p style={{ ...TYPE.body, color: 'var(--text-primary)' }}>{client.description}</p>
        ) : (
          <EmptyState
            title="No description yet"
            description="Add a short description of this engagement to improve AI-generated documents."
          />
        )}

        <div className="mt-4">
          {client.driveFolderUrl !== null ? (
            <a
              href={client.driveFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5"
              style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}
            >
              <ExternalLink aria-hidden="true" size={14} />
              Open Drive folder
            </a>
          ) : (
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              No Drive folder linked.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
