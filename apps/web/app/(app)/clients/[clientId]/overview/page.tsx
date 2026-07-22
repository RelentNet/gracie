'use client';

import { use, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Client, Meeting, Task } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { priorityBadge, taskStatusLabel } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextAreaField, FormError } from '@/components/ui/Field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import { ClientDomainsCard } from '../ClientDomainsCard';
import { ClientDetailsCard } from '@/components/client/ClientDetailsCard';
import { HealthCard } from '@/components/client/HealthCard';

/**
 * Client tab 1 — Overview (docs/08 §9, P2.1). Algorithmic relationship-health card
 * (auto badge + breakdown + admin adjust), last-meeting snapshot, top-3 open tasks,
 * an editable Client Details card + description, and the domains manager. Data via
 * `GET /api/clients/:id/overview`; editors mutate via `PATCH /api/clients/:id`.
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
  const { can, canEdit } = useAuth();
  const editable = canEdit();

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

  function setClient(updated: Client): void {
    setData((prev) => (prev === null ? prev : { ...prev, client: updated }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <HealthCard clientId={clientId} fallbackScore={client.relationshipHealth} />

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
                {formatDateTime(lastMeeting.dateTime)}
                {lastMeeting.durationMinutes !== null ? ` · ${lastMeeting.durationMinutes} min` : null}
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

      {/* Client details (editable facts + drive link) */}
      <ClientDetailsCard client={client} editable={editable} onChange={setClient} />

      {/* Description (editable) */}
      <DescriptionCard client={client} editable={editable} onChange={setClient} />

      {/* Domains manager — editor tier only, not for the internal workspace. */}
      {can('file.upload') && client.type !== 'internal' ? <ClientDomainsCard clientId={clientId} /> : null}
    </div>
  );
}

function DescriptionCard({
  client,
  editable,
  onChange,
}: {
  readonly client: Client;
  readonly editable: boolean;
  readonly onChange: (client: Client) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(client.description ?? '');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { client: updated } = await apiClient.patch<{ client: Client }>(`/api/clients/${client.id}`, {
        description: draft,
      });
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Description"
        description="Used as context in AI generation (5-layer prompt)."
        action={
          editable && !editing ? (
            <button
              type="button"
              onClick={(): void => {
                setDraft(client.description ?? '');
                setError(null);
                setEditing(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
              style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', cursor: 'pointer', background: 'transparent' }}
            >
              <Pencil aria-hidden="true" size={14} />
              Edit
            </button>
          ) : undefined
        }
      />
      {editing ? (
        <div className="flex flex-col gap-3">
          <TextAreaField
            label="Description"
            value={draft}
            onChange={setDraft}
            rows={4}
            placeholder="Short description of this engagement…"
          />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={(): void => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={(): void => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : client.description !== null && client.description !== '' ? (
        <p style={{ ...TYPE.body, color: 'var(--text-primary)' }}>{client.description}</p>
      ) : (
        <EmptyState
          title="No description yet"
          description="Add a short description of this engagement to improve AI-generated documents."
        />
      )}
    </Card>
  );
}
