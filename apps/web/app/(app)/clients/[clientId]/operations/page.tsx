'use client';

import { use } from 'react';
import { FileText } from 'lucide-react';
import type { Document, Meeting, Task } from '@gracie/shared';

import {
  getClientById,
  getDocumentsByClient,
  getMeetingsByClient,
  getTasksByClient,
  getUserName,
} from '@/lib/mock';
import { TYPE } from '@/lib/typography';
import { formatEasternDate, formatEasternDateTime } from '@/lib/format';
import { priorityBadge, taskStatusLabel } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import type { PipelineStatus } from '@gracie/shared';

/**
 * Client tab 4 — Operations (docs/08 §9). Client-scoped task table (priority
 * badges), pipeline run history, and transcript history. Pipeline runs and
 * transcripts are derived from the mock meetings/documents selectors
 * (Phase 1B: replaced by `pipeline_runs` + transcript documents from the API).
 */
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
  const client = getClientById(clientId);

  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  const tasks: readonly Task[] = getTasksByClient(clientId).filter((task) => !task.isArchived);
  const meetings: readonly Meeting[] = getMeetingsByClient(clientId);
  const transcripts: readonly Document[] = getDocumentsByClient(clientId).filter(
    (doc) => doc.documentType === 'other' && doc.sourceBadge === 'meeting',
  );

  return (
    <Tabs
      ariaLabel="Operations sections"
      items={[
        {
          id: 'tasks',
          label: 'Tasks',
          content: <TasksPanel tasks={tasks} />,
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

function TasksPanel({ tasks }: { readonly tasks: readonly Task[] }): React.JSX.Element {
  return (
    <Card className="p-0">
      <div className="p-6 pb-3">
        <CardHeader title="Client Tasks" description="All active tasks scoped to this client." />
      </div>
      {tasks.length === 0 ? (
        <div className="p-6 pt-0">
          <EmptyState title="No tasks" description="No active tasks for this client." />
        </div>
      ) : (
        <Table>
          <THead>
            <TH>Task</TH>
            <TH>Owner</TH>
            <TH>Due</TH>
            <TH>Status</TH>
            <TH>Priority</TH>
          </THead>
          <TBody>
            {tasks.map((task) => {
              const badge = priorityBadge(task.hasPriorityFlag);
              return (
                <TRow key={task.id}>
                  <TCell>{task.description}</TCell>
                  <TCell>{getUserName(task.ownerUserId)}</TCell>
                  <TCell>{task.dueDate !== null ? formatEasternDate(task.dueDate) : '—'}</TCell>
                  <TCell>{taskStatusLabel(task.status)}</TCell>
                  <TCell>
                    <Badge bg={badge.bg} fg={badge.fg}>
                      {badge.label}
                    </Badge>
                  </TCell>
                </TRow>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
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
    <Table>
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
              <TCell>{formatEasternDateTime(meeting.dateTime)}</TCell>
              <TCell>
                <Badge bg={color.bg} fg={color.fg}>
                  {PIPELINE_STATUS_LABEL[meeting.pipelineStatus]}
                </Badge>
              </TCell>
              <TCell>
                {meeting.pipelineCompletedAt !== null
                  ? formatEasternDateTime(meeting.pipelineCompletedAt)
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
  readonly transcripts: readonly Document[];
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
      {transcripts.map((doc) => (
        <li
          key={doc.id}
          className="flex items-center gap-3 rounded-md border p-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <FileText aria-hidden="true" size={16} style={{ color: 'var(--text-secondary)' }} />
          <div className="flex flex-col">
            <span style={TYPE.body}>{doc.fileName}</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              {formatEasternDateTime(doc.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
