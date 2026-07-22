'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Pencil,
} from 'lucide-react';
import type { Task, TaskNote, TaskStatus } from '@gracie/shared';
import { TASK_STATUSES } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { getClientName, getUserInitials, getUserName } from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  daysOverdue,
  priorityBadge,
  taskStatusLabel,
  taskUrgency,
} from '@/lib/client-display';
import type { TaskUrgency } from '@/lib/client-display';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Badge } from '@/components/ui/Badge';
import { PageContainer } from '@/components/ui/PageContainer';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Module 6 — Task Board (docs/08 §8 M6, §9).
 *
 * Cross-client task table. Overdue rows are toned red and 48-hour rows amber
 * (Table `tone="critical" | "warning"`). Filters narrow by client, owner,
 * status, and priority; "Show Archived" toggles archived tasks in.
 *
 * ROLE RULES (docs/08 §7, D14):
 *   - Edit / Archive / Add Note appear ONLY for editors (`canEdit()`); they are
 *     absent from the DOM for viewers.
 *   - "Mark Complete": editors may complete ANY task; viewers may complete ONLY
 *     their OWN tasks (`ownerUserId === user.id`). For other tasks a viewer sees
 *     the button disabled (D14 `task.completeOwn`).
 *
 * Tasks are fetched from `GET /api/tasks` (real Supabase data); the archived
 * toggle re-fetches with `?archived=true`. Task notes load on demand from
 * `GET /api/tasks/[taskId]/notes` when a row is expanded. Mutating actions
 * below remain visual-only (no network) — Phase 1B wires these to
 * `PATCH/POST /api/tasks/...`. The "today" reference is the fixed mock app date
 * (2026-04-24); Phase 1B replaces `TODAY` with `new Date()`.
 */

// Phase 1B: replace with `new Date()` once tasks come from the live API.
const TODAY = new Date('2026-04-24T14:00:00.000Z');

type StatusFilter = TaskStatus | 'all';
type ClientFilter = string | 'all';
type OwnerFilter = string | 'all';
type PriorityFilter = 'all' | 'priority' | 'standard';

interface TasksResponse {
  readonly tasks: readonly Task[];
}

interface TaskNotesResponse {
  readonly notes: readonly TaskNote[];
}

const URGENCY_TONE: Readonly<Record<TaskUrgency, 'critical' | 'warning' | 'default'>> = {
  overdue: 'critical',
  due_soon: 'warning',
  none: 'default',
};

export default function TasksPage(): React.JSX.Element {
  const { user, canEdit } = useAuth();
  const editable = canEdit();

  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Active-only by default; the archived toggle re-fetches with ?archived=true (M6).
  useEffect(() => {
    let active = true;
    setTasks(null);
    setError(null);
    const path = showArchived ? '/api/tasks?archived=true' : '/api/tasks';
    apiClient
      .get<TasksResponse>(path)
      .then((data) => {
        if (active) setTasks(data.tasks);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load tasks');
      });
    return (): void => {
      active = false;
    };
  }, [showArchived]);

  const baseTasks = useMemo<readonly Task[]>(() => tasks ?? [], [tasks]);

  // Distinct clients/owners present in the base set drive the filter dropdowns.
  const clientOptions = useMemo<readonly string[]>(
    () => uniqueSorted(baseTasks.map((task) => task.clientId), getClientName),
    [baseTasks],
  );
  const ownerOptions = useMemo<readonly string[]>(
    () =>
      uniqueSorted(
        baseTasks.flatMap((task) => (task.ownerUserId !== null ? [task.ownerUserId] : [])),
        getUserName,
      ),
    [baseTasks],
  );

  const filteredTasks = useMemo<readonly Task[]>(
    () =>
      baseTasks.filter((task) => {
        const matchesClient = clientFilter === 'all' || task.clientId === clientFilter;
        const matchesOwner = ownerFilter === 'all' || task.ownerUserId === ownerFilter;
        const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
        const matchesPriority =
          priorityFilter === 'all' ||
          (priorityFilter === 'priority' ? task.hasPriorityFlag : !task.hasPriorityFlag);
        return matchesClient && matchesOwner && matchesStatus && matchesPriority;
      }),
    [baseTasks, clientFilter, ownerFilter, statusFilter, priorityFilter],
  );

  const overdueCount = useMemo<number>(
    () =>
      filteredTasks.filter(
        (task) => taskUrgency(task.dueDate, task.status === 'complete', TODAY) === 'overdue',
      ).length,
    [filteredTasks],
  );

  if (error !== null) {
    return <ErrorState title="Couldn’t load tasks" description={error} />;
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Task Board</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          {tasks === null
            ? 'Loading tasks…'
            : `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} across all clients${
                overdueCount > 0 ? ` · ${overdueCount} overdue` : ''
              }.`}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
          allLabel="All clients"
          options={clientOptions.map((id) => ({ value: id, label: getClientName(id) }))}
        />
        <FilterSelect
          label="Owner"
          value={ownerFilter}
          onChange={setOwnerFilter}
          allLabel="All owners"
          options={ownerOptions.map((id) => ({ value: id, label: getUserName(id) }))}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(value): void => setStatusFilter(value as StatusFilter)}
          allLabel="All statuses"
          options={TASK_STATUSES.map((value) => ({ value, label: taskStatusLabel(value) }))}
        />
        <FilterSelect
          label="Priority"
          value={priorityFilter}
          onChange={(value): void => setPriorityFilter(value as PriorityFilter)}
          allLabel="All priorities"
          options={[
            { value: 'priority', label: 'Priority flag' },
            { value: 'standard', label: 'Standard' },
          ]}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event): void => setShowArchived(event.target.checked)}
            className="size-4 rounded border"
            style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
          />
          <span style={{ ...TYPE.secondary }}>Show archived</span>
        </label>
      </div>

      {tasks === null ? (
        <LoadingState label="Loading tasks…" />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="No matching tasks"
          description="No tasks match the current filters. Adjust the client, owner, status, or priority filters to see results."
        />
      ) : (
        <Table minWidth="60rem" scrollRegionLabel="Task board">
          <THead>
            <TH style={{ width: '2.5rem' }}>
              <span className="sr-only">Expand notes</span>
            </TH>
            <TH>Status</TH>
            <TH>Task</TH>
            <TH>Client</TH>
            <TH>Owner</TH>
            <TH>Due Date</TH>
            <TH>Priority</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </THead>
          <TBody>
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                editable={editable}
                currentUserId={user.id}
                isExpanded={expandedTaskId === task.id}
                onToggleExpand={(): void =>
                  setExpandedTaskId((current) => (current === task.id ? null : task.id))
                }
              />
            ))}
          </TBody>
        </Table>
      )}
    </PageContainer>
  );
}

function TaskRow({
  task,
  editable,
  currentUserId,
  isExpanded,
  onToggleExpand,
}: {
  readonly task: Task;
  readonly editable: boolean;
  readonly currentUserId: string;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
}): React.JSX.Element {
  const isComplete = task.status === 'complete';
  const urgency = taskUrgency(task.dueDate, isComplete, TODAY);
  const tone = URGENCY_TONE[urgency];
  const priority = priorityBadge(task.hasPriorityFlag);

  // Viewers may complete ONLY their own tasks; editors may complete any task.
  const isOwnTask = task.ownerUserId === currentUserId;
  const canMarkComplete = !isComplete && (editable || isOwnTask);

  // Columns the expanded notes row spans (THead always renders 8 columns:
  // expander, status, task, client, owner, due, priority, actions).
  const COLUMN_COUNT = 8;

  return (
    <Fragment>
      <TRow tone={tone}>
        <TCell style={{ width: '2.5rem' }}>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Hide notes' : 'Show notes'}
            className="rounded-md p-1"
            style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" size={16} />
            ) : (
              <ChevronRight aria-hidden="true" size={16} />
            )}
          </button>
        </TCell>
        <TCell>
          <Badge bg={statusStyle(task.status).bg} fg={statusStyle(task.status).fg}>
            {taskStatusLabel(task.status)}
          </Badge>
        </TCell>
        <TCell>
          <span style={TYPE.bodyStrong}>{task.description}</span>
        </TCell>
        <TCell>
          <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
            {getClientName(task.clientId)}
          </Badge>
        </TCell>
        <TCell>
          <span className="flex items-center gap-2">
            <ClientAvatar initials={getUserInitials(task.ownerUserId)} size="sm" />
            <span style={TYPE.secondary}>{getUserName(task.ownerUserId)}</span>
          </span>
        </TCell>
        <TCell>
          <DueDateCell task={task} urgency={urgency} />
        </TCell>
        <TCell>
          {task.hasPriorityFlag ? (
            <Badge bg={priority.bg} fg={priority.fg}>
              {priority.label}
            </Badge>
          ) : (
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>—</span>
          )}
        </TCell>
        <TCell>
          <span className="flex items-center justify-end gap-1">
            <RowAction
              label={`Mark "${task.description}" complete`}
              icon={<Check size={16} />}
              disabled={!canMarkComplete}
              title={
                isComplete
                  ? 'Already complete'
                  : canMarkComplete
                    ? 'Mark complete'
                    : 'You can only complete your own tasks'
              }
            />
            {editable ? (
              <>
                <RowAction label={`Edit "${task.description}"`} icon={<Pencil size={16} />} />
                <RowAction
                  label={`Add note to "${task.description}"`}
                  icon={<MessageSquarePlus size={16} />}
                />
                <RowAction
                  label={`Archive "${task.description}"`}
                  icon={<Archive size={16} />}
                  disabled={task.isArchived}
                  title={task.isArchived ? 'Already archived' : 'Archive task'}
                />
              </>
            ) : null}
          </span>
        </TCell>
      </TRow>
      {isExpanded ? (
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <td colSpan={COLUMN_COUNT} className="px-4 py-3" style={{ backgroundColor: '#f8fafc' }}>
            <TaskNotes taskId={task.id} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function DueDateCell({
  task,
  urgency,
}: {
  readonly task: Task;
  readonly urgency: TaskUrgency;
}): React.JSX.Element {
  if (task.dueDate === null) {
    return <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No due date</span>;
  }
  const overdueDays = urgency === 'overdue' ? daysOverdue(task.dueDate, TODAY) : 0;
  return (
    <span className="flex flex-col">
      <span style={TYPE.secondary}>{formatDate(task.dueDate)}</span>
      {urgency === 'overdue' ? (
        <span style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {overdueDays} day{overdueDays === 1 ? '' : 's'} overdue
        </span>
      ) : urgency === 'due_soon' ? (
        <span style={{ ...TYPE.label, color: 'var(--color-amber-600)' }}>Due within 48h</span>
      ) : null}
    </span>
  );
}

function TaskNotes({ taskId }: { readonly taskId: string }): React.JSX.Element {
  const [notes, setNotes] = useState<readonly TaskNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setNotes(null);
    setError(null);
    apiClient
      .get<TaskNotesResponse>(`/api/tasks/${taskId}/notes`)
      .then((data) => {
        if (active) setNotes(data.notes);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load notes');
      });
    return (): void => {
      active = false;
    };
  }, [taskId]);

  if (error !== null) {
    return (
      <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
        {error}
      </p>
    );
  }
  if (notes === null) {
    return (
      <p role="status" aria-live="polite" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        Loading notes…
      </p>
    );
  }
  if (notes.length === 0) {
    return (
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        No notes on this task yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((note) => (
        <li key={note.id} className="flex items-start gap-3">
          <ClientAvatar initials={getUserInitials(note.authorUserId)} size="sm" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span style={TYPE.bodyStrong}>{getUserName(note.authorUserId)}</span>
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {formatDateTime(note.createdAt)}
              </span>
            </span>
            <span style={TYPE.body}>{note.content}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RowAction({
  label,
  icon,
  disabled = false,
  title,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly disabled?: boolean;
  readonly title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      className="rounded-md p-1"
      style={{
        color: 'var(--text-secondary)',
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
    </button>
  );
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  readonly label: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly allLabel: string;
  readonly options: readonly FilterOption[];
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      <select
        value={value}
        onChange={(event): void => onChange(event.target.value as T)}
        className="rounded-lg border bg-white px-3 py-2"
        style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Status → badge colors (docs/08 §5 vocabulary mapped to the 3 task statuses). */
function statusStyle(status: TaskStatus): { readonly bg: string; readonly fg: string } {
  switch (status) {
    case 'open':
      return { bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)' };
    case 'in_progress':
      return { bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' };
    case 'complete':
      return { bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)' };
  }
}

/** Distinct, label-sorted ids from a list, using `nameOf` for the sort key. */
function uniqueSorted(ids: readonly string[], nameOf: (id: string) => string): readonly string[] {
  return Array.from(new Set(ids)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}
