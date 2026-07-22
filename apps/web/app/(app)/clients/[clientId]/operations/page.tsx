'use client';

import { use, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Meeting, Task } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ClientTasksPanel } from '@/components/client/ClientTasksPanel';
import type { PipelineStatus } from '@gracie/shared';

/**
 * Client tab 4 — Operations (docs/08 §9). Client-scoped task table (priority
 * badges), pipeline run history, and transcript history. Data via
 * `GET /api/clients/:id/operations` (real Supabase data) returning client-scoped
 * tasks and meetings. Pipeline runs and transcript history are derived from the
 * meetings' pipeline status / transcript-received flags. User names still
 * resolve through the mock display lookup (users module not yet wired).
 */
interface OperationsResponse {
  readonly tasks: readonly Task[];
  readonly meetings: readonly Meeting[];
}

const PIPELINE_STATUS_LABEL: Readonly<Record<PipelineStatus, string>> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  awaiting_transcript: 'Awaiting Transcript',
  processing: 'Processing',
  complete: 'Complete',
  needs_attention: 'Needs Attention',
  cancelled: 'Cancelled',
};

const PIPELINE_STATUS_COLOR: Readonly<Record<PipelineStatus, { bg: string; fg: string }>> = {
  scheduled: { bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)' },
  in_progress: { bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  awaiting_transcript: { bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)' },
  processing: { bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  complete: { bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)' },
  needs_attention: { bg: 'var(--color-red-100)', fg: 'var(--color-red-600)' },
  cancelled: { bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)' },
};

export default function ClientOperationsPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { canEdit } = useAuth();

  const [data, setData] = useState<OperationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<OperationsResponse>(`/api/clients/${clientId}/operations`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load operations');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  if (error !== null) {
    return <ErrorState title="Couldn’t load operations" description={error} />;
  }

  if (data === null) {
    return <LoadingState label="Loading operations…" />;
  }

  const tasks = data.tasks.filter((task) => !task.isArchived);
  const { meetings } = data;
  const transcripts = meetings.filter((meeting) => meeting.isTranscriptReceived);

  return (
    <Tabs
      ariaLabel="Operations sections"
      items={[
        {
          id: 'tasks',
          label: 'Tasks',
          content: <ClientTasksPanel clientId={clientId} initialTasks={tasks} editable={canEdit()} />,
        },
        {
          id: 'pipeline',
          label: 'Pipeline Runs',
          content: <PipelinePanel meetings={meetings} />,
        },
        {
          id: 'transcripts',
          label: 'Transcripts',
          content: <TranscriptsPanel transcripts={transcripts} />,
        },
      ]}
    />
  );
}

function PipelinePanel({ meetings }: { readonly meetings: readonly Meeting[] }): React.JSX.Element {
  if (meetings.length === 0) {
    return (
      <EmptyState
        title="No pipeline runs"
        description="Pipeline runs appear here once meetings are processed for this client."
      />
    );
  }
  return (
    <Table minWidth="40rem" scrollRegionLabel="Pipeline runs">
      <THead>
        <TH>Meeting</TH>
        <TH>Date</TH>
        <TH>Status</TH>
        <TH>Completed</TH>
      </THead>
      <TBody>
        {meetings.map((meeting) => {
          const color = PIPELINE_STATUS_COLOR[meeting.pipelineStatus];
          return (
            <TRow key={meeting.id}>
              <TCell>{meeting.title ?? 'Untitled meeting'}</TCell>
              <TCell>{formatDateTime(meeting.dateTime)}</TCell>
              <TCell>
                <Badge bg={color.bg} fg={color.fg}>
                  {PIPELINE_STATUS_LABEL[meeting.pipelineStatus]}
                </Badge>
              </TCell>
              <TCell>
                {meeting.pipelineCompletedAt !== null
                  ? formatDateTime(meeting.pipelineCompletedAt)
                  : '—'}
              </TCell>
            </TRow>
          );
        })}
      </TBody>
    </Table>
  );
}

function TranscriptsPanel({
  transcripts,
}: {
  readonly transcripts: readonly Meeting[];
}): React.JSX.Element {
  if (transcripts.length === 0) {
    return (
      <EmptyState
        title="No transcripts"
        description="Meeting transcripts for this client will be listed here once received."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {transcripts.map((meeting) => (
        <li
          key={meeting.id}
          className="flex items-center gap-3 rounded-md border p-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <FileText aria-hidden="true" size={16} style={{ color: 'var(--text-secondary)' }} />
          <div className="flex flex-col">
            <span style={TYPE.body}>{meeting.title ?? 'Untitled meeting'}</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              {formatDateTime(meeting.dateTime)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
