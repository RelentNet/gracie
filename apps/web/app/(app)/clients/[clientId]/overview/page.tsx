'use client';

import { use, useEffect, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import type { Client, Meeting, Task } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatEasternDateTime } from '@/lib/format';
import { healthColor, healthLabel, priorityBadge, taskStatusLabel } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import { ClientDomainsCard } from '../ClientDomainsCard';

/**
 * Client tab 1 — Overview (docs/08 §9). Relationship health card, last-meeting
 * snapshot, top-3 open tasks, an editable-looking description, and the Drive
 * quick-link. Data via `GET /api/clients/:id/overview` (real Supabase data).
 * User names still resolve through the mock display lookup (users module not
 * yet wired).
 */
interface OverviewResponse {
  readonly client: Client;
  readonly lastMeeting: Meeting | null;
  readonly topTasks: readonly Task[];
}

export default function ClientOverviewPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { can } = useAuth();

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<OverviewResponse>(`/api/clients/${clientId}/overview`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load overview');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  if (error !== null) {
    return <ErrorState title="Couldn’t load overview" description={error} />;
  }

  if (data === null) {
    return <LoadingState label="Loading overview…" />;
  }

  const { client, lastMeeting, topTasks } = data;

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
          {lastMeeting === null ? (
            <EmptyState
              title="No meetings yet"
              description="Scheduled and completed meetings for this client will appear here."
            />
          ) : (
            <div className="flex flex-col gap-1">
              <p style={TYPE.bodyStrong}>{lastMeeting.title ?? 'Untitled meeting'}</p>
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {formatEasternDateTime(lastMeeting.dateTime)}
                {lastMeeting.durationMinutes !== null
                  ? ` · ${lastMeeting.durationMinutes} min`
                  : null}
              </p>
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                Led by {getUserName(lastMeeting.meetingLeadUserId)} ·{' '}
                {lastMeeting.attendeeUserIds.length} attendees
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Top open tasks */}
      <Card>
        <CardHeader title="Top Open Tasks" description="The three highest-priority open items." />
        {topTasks.length === 0 ? (
          <EmptyState
            title="No open tasks"
            description="There are no open tasks for this client right now."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {topTasks.map((task) => {
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

      {/* Domains manager — editor tier only, and not for the internal workspace
          (which is matched by internal domains, not client_domains). `file.upload`
          is the editor-tier permission (admin + standard; viewers read-only). */}
      {can('file.upload') && client.type !== 'internal' ? (
        <ClientDomainsCard clientId={clientId} />
      ) : null}
    </div>
  );
}
