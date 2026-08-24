'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { Client, Task, TaskNote, TaskStatus } from '@gracie/shared';
import { TASK_STATUSES } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  canSeeTaskBoard,
  daysOverdue,
  priorityBadge,
  taskStatusLabel,
  taskUrgency,
} from '@/lib/client-display';
import type { TaskUrgency } from '@/lib/client-display';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextField } from '@/components/ui/Field';
import { PageContainer } from '@/components/ui/PageContainer';
import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
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
 *   - Edit / Assign / Archive / Delete appear ONLY for editors (`canEdit()`); they
 *     are absent from the DOM for viewers.
 *   - "Mark Complete" / "Reopen": editors may toggle ANY task; viewers may toggle
 *     ONLY their OWN tasks (`ownerUserId === user.internalId`, D14 `task.completeOwn`).
 *     For other tasks a viewer sees the button disabled.
 *
 * Tasks are fetched from `GET /api/tasks` (real Supabase data); the archived toggle
 * re-fetches with `?archived=true`. Owner names resolve from `GET /api/users` (the
 * non-admin assignable-users list) so the assign picker works for standard editors
 * and owners render correctly. Client names resolve from `GET /api/clients?type=all`
 * (every non-internal org); a task whose org isn't in that set — an internal GA-org
 * task — renders as "Internal". Every action calls `PATCH /api/tasks/:id` and updates
 * the board in place from the response — no full-page reload. "Delete" is a soft
 * delete (archive) — alpha keeps every row recoverable via "Show archived" → Restore.
 */

type StatusFilter = TaskStatus | 'all';
type ClientFilter = string | 'all';
type OwnerFilter = string | 'all';
type PriorityFilter = 'all' | 'priority' | 'standard';

interface AssignableUser {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
}

interface TasksResponse {
  readonly tasks: readonly Task[];
}

interface UsersResponse {
  readonly users: readonly AssignableUser[];
}

interface TaskNotesResponse {
  readonly notes: readonly TaskNote[];
}

const URGENCY_TONE: Readonly<Record<TaskUrgency, 'critical' | 'warning' | 'default'>> = {
  overdue: 'critical',
  due_soon: 'warning',
  none: 'default',
};

type UsersById = ReadonlyMap<string, AssignableUser>;
type ClientNamesById = ReadonlyMap<string, string>;

/** Owner/author display name — "Unassigned" for null, "Unknown" for an unknown id. */
function displayName(users: UsersById, id: string | null): string {
  if (id === null) return 'Unassigned';
  return users.get(id)?.name ?? 'Unknown';
}

/**
 * Client display name from the real roster. A task's org that isn't in the
 * non-internal roster (`/api/clients?type=all`) is an internal GA-org task, so it
 * reads "Internal" rather than the old mock's "Unknown Client".
 */
function clientName(clients: ClientNamesById, id: string): string {
  return clients.get(id) ?? 'Internal';
}

/** Owner/author avatar initials — "—" for null or unknown. */
function displayInitials(users: UsersById, id: string | null): string {
  if (id === null) return '—';
  return users.get(id)?.initials ?? '—';
}

export default function TasksPage(): React.JSX.Element {
  const { can, taskBoardVisibleToAll } = useAuth();

  // The cross-client Task Board is an admin triage surface by default. The operator can
  // reveal it to everyone via the Settings → Company toggle (`taskBoardVisibleToAll`);
  // the same rule gates the nav item and the list/export APIs. This thin wrapper keeps
  // TaskBoard's hooks unconditional, and the gate never 500s — it renders a placeholder.
  if (!canSeeTaskBoard(can('task.manageBoard'), taskBoardVisibleToAll)) {
    return (
      <PageContainer>
        <PagePlaceholder
          title="Task Board"
          description="Cross-client task triage."
          emptyTitle="Not available yet"
          emptyDescription="The global Task Board isn't open to your account yet. Tasks for each client appear on that client's Tasks panel, where you can complete and archive them. An administrator can turn the board on for everyone in Settings → Company."
        />
      </PageContainer>
    );
  }
  return <TaskBoard />;
}

function TaskBoard(): React.JSX.Element {
  const { user, canEdit, can } = useAuth();
  const editable = canEdit();
  // Bulk select + Merge + Mass-delete hit ADMIN-only endpoints, so gate them on the admin
  // capability — not `editable` (standard users are editors). Since #122 can reveal the
  // board to non-admins, this keeps them from seeing bulk actions that would 403.
  const canBulk = can('task.manageBoard');
  const currentUserId = user.internalId;

  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [users, setUsers] = useState<readonly AssignableUser[]>([]);
  const [clients, setClients] = useState<readonly Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Modals (page-level so a single instance renders; null = closed).
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [assignTask, setAssignTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);

  // Bulk multi-select (admin board only). Selection is tracked as an id set and is
  // always intersected with the *visible* filtered rows, so an action never touches a
  // task that scrolled out of the current filter.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [bulkModal, setBulkModal] = useState<'delete' | 'merge' | null>(null);

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

  // Assignable users drive both the owner display and the assign picker.
  useEffect(() => {
    let active = true;
    apiClient
      .get<UsersResponse>('/api/users')
      .then((data) => {
        if (active) setUsers(data.users);
      })
      .catch(() => {
        /* Non-fatal: owner names fall back to "Unknown" and the picker is empty. */
      });
    return (): void => {
      active = false;
    };
  }, []);

  // Real client roster drives the client column + filter (replaces the mock resolver).
  // Non-fatal: a failed load leaves every task labelled "Internal", never a crash.
  useEffect(() => {
    let active = true;
    apiClient
      .get<{ clients: readonly Client[] }>('/api/clients?type=all')
      .then((data) => {
        if (active) setClients(data.clients);
      })
      .catch(() => {
        /* Non-fatal: client names fall back to "Internal". */
      });
    return (): void => {
      active = false;
    };
  }, []);

  const usersById = useMemo<UsersById>(() => new Map(users.map((u) => [u.id, u])), [users]);
  const clientNamesById = useMemo<ClientNamesById>(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const baseTasks = useMemo<readonly Task[]>(() => tasks ?? [], [tasks]);

  // Distinct clients/owners present in the base set drive the filter dropdowns.
  const clientOptions = useMemo<readonly string[]>(
    () => uniqueSorted(baseTasks.map((task) => task.clientId), (id) => clientName(clientNamesById, id)),
    [baseTasks, clientNamesById],
  );
  const ownerOptions = useMemo<readonly string[]>(
    () =>
      uniqueSorted(
        baseTasks.flatMap((task) => (task.ownerUserId !== null ? [task.ownerUserId] : [])),
        (id) => usersById.get(id)?.name ?? 'Unknown',
      ),
    [baseTasks, usersById],
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
        (task) => taskUrgency(task.dueDate, task.status === 'complete', new Date()) === 'overdue',
      ).length,
    [filteredTasks],
  );

  // Merge an updated task back into the board. When archived tasks are hidden, a
  // task that just became archived (Archive/Delete) drops out of view.
  function applyUpdate(updated: Task): void {
    setTasks((prev) => {
      if (prev === null) return prev;
      if (!showArchived && updated.isArchived) return prev.filter((t) => t.id !== updated.id);
      return prev.map((t) => (t.id === updated.id ? updated : t));
    });
  }

  // Core PATCH: throws on failure so callers (modals) can surface a local error.
  async function submitPatch(taskId: string, patch: Record<string, unknown>): Promise<void> {
    const { task } = await apiClient.patch<{ task: Task }>(`/api/tasks/${taskId}`, patch);
    applyUpdate(task);
  }

  // Quick row action (complete/reopen/archive/restore): one row at a time,
  // errors surface in the page-level banner.
  async function rowPatch(taskId: string, patch: Record<string, unknown>): Promise<void> {
    if (rowBusyId !== null) return;
    setRowBusyId(taskId);
    setActionError(null);
    try {
      await submitPatch(taskId, patch);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed. Try again.');
    } finally {
      setRowBusyId(null);
    }
  }

  // Hard delete (admin-only, tasks lifecycle): permanently removes the task, then drops
  // it from the board. Archive stays the recoverable path; this is the permanent one.
  async function rowDelete(taskId: string): Promise<void> {
    if (rowBusyId !== null) return;
    setRowBusyId(taskId);
    setActionError(null);
    try {
      await apiClient.del(`/api/tasks/${taskId}`);
      setTasks((prev) => (prev === null ? prev : prev.filter((t) => t.id !== taskId)));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed. Try again.');
    } finally {
      setRowBusyId(null);
    }
  }

  // Selection ∩ visible rows: everything (count, primary, same-client) derives from this,
  // so a hidden-but-still-selected task can never be deleted/merged out from under a filter.
  const selectedTasks = useMemo<readonly Task[]>(
    () => filteredTasks.filter((task) => selectedIds.has(task.id)),
    [filteredTasks, selectedIds],
  );
  const selectedCount = selectedTasks.length;
  const allVisibleSelected = filteredTasks.length > 0 && selectedCount === filteredTasks.length;
  // Merge is client-scoped — a task belongs to one client (tasks lifecycle).
  const selectedClientCount = useMemo<number>(
    () => new Set(selectedTasks.map((task) => task.clientId)).size,
    [selectedTasks],
  );
  const canMerge = selectedCount >= 2 && selectedClientCount === 1;

  function toggleSelect(taskId: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  // Header checkbox: select every visible row, or clear when all are already selected.
  function toggleSelectAll(): void {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(filteredTasks.map((task) => task.id)));
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
  }

  // Mass hard-delete the selected rows in one call, then drop them from the board in place.
  async function runBulkDelete(): Promise<void> {
    const ids = selectedTasks.map((task) => task.id);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      await apiClient.post('/api/tasks/bulk-delete', { ids });
      const removed = new Set(ids);
      setTasks((prev) => (prev === null ? prev : prev.filter((t) => !removed.has(t.id))));
      clearSelection();
      setBulkModal(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed. Try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  // Merge the selected same-client tasks into the first (primary): fold the others in,
  // then drop them and replace the primary with the returned survivor — all in place.
  async function runMerge(): Promise<void> {
    const [primary, ...rest] = selectedTasks;
    if (primary === undefined || rest.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      const { task } = await apiClient.post<{ task: Task }>('/api/tasks/merge', {
        primaryId: primary.id,
        mergedIds: rest.map((t) => t.id),
      });
      const removed = new Set(rest.map((t) => t.id));
      setTasks((prev) =>
        prev === null ? prev : prev.filter((t) => !removed.has(t.id)).map((t) => (t.id === task.id ? task : t)),
      );
      clearSelection();
      setBulkModal(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Merge failed. Try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  if (error !== null) {
    return <ErrorState title="Couldn’t load tasks" description={error} />;
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Task Board</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {tasks === null
              ? 'Loading tasks…'
              : `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} across all clients${
                  overdueCount > 0 ? ` · ${overdueCount} overdue` : ''
                }.`}
          </p>
        </div>
        <a
          href={showArchived ? '/api/tasks/export?archived=true' : '/api/tasks/export'}
          download
          className="inline-flex items-center justify-center gap-2 rounded-lg border shadow-sm transition-shadow hover:shadow-md"
          style={{
            backgroundColor: 'var(--color-white)',
            color: 'var(--text-primary)',
            borderColor: 'var(--border-subtle)',
            padding: '0.5rem 0.875rem',
            ...TYPE.bodyStrong,
          }}
        >
          <Download size={16} aria-hidden="true" />
          Download CSV
        </a>
      </header>

      {actionError !== null ? (
        <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
          allLabel="All clients"
          options={clientOptions.map((id) => ({ value: id, label: clientName(clientNamesById, id) }))}
        />
        <FilterSelect
          label="Owner"
          value={ownerFilter}
          onChange={setOwnerFilter}
          allLabel="All owners"
          options={ownerOptions.map((id) => ({ value: id, label: displayName(usersById, id) }))}
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
            { value: 'priority', label: 'High' },
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

      {canBulk && selectedCount > 0 ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-blue-50)' }}
          role="region"
          aria-label="Selected tasks"
        >
          <span style={TYPE.bodyStrong}>
            {selectedCount} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              // Clickable at 2+ selected even across clients — the modal then shows the
              // plain "one client only" message, rather than a silently-disabled button.
              disabled={bulkBusy || selectedCount < 2}
              title={
                selectedCount < 2 ? 'Select 2 or more tasks to merge' : 'Merge the selected tasks into one'
              }
              onClick={(): void => setBulkModal('merge')}
            >
              Merge
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={bulkBusy}
              onClick={(): void => setBulkModal('delete')}
            >
              Delete selected
            </Button>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkBusy}
            className="ml-auto rounded-md px-2 py-1"
            style={{ ...TYPE.secondary, color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      ) : null}

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
            {canBulk ? (
              <TH style={{ width: '2.5rem' }}>
                <SelectAllCheckbox
                  checked={allVisibleSelected}
                  indeterminate={selectedCount > 0 && !allVisibleSelected}
                  disabled={bulkBusy}
                  onChange={toggleSelectAll}
                />
              </TH>
            ) : null}
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
                currentUserId={currentUserId}
                usersById={usersById}
                clientNamesById={clientNamesById}
                selectable={canBulk}
                selected={selectedIds.has(task.id)}
                selectDisabled={bulkBusy}
                onToggleSelect={(): void => toggleSelect(task.id)}
                busy={rowBusyId === task.id}
                isExpanded={expandedTaskId === task.id}
                onToggleExpand={(): void =>
                  setExpandedTaskId((current) => (current === task.id ? null : task.id))
                }
                onPatch={(patch): void => void rowPatch(task.id, patch)}
                onEdit={(): void => setEditTask(task)}
                onAssign={(): void => setAssignTask(task)}
                onDelete={(): void => setDeleteTask(task)}
              />
            ))}
          </TBody>
        </Table>
      )}

      {editTask !== null ? (
        <EditTaskModal
          task={editTask}
          onClose={(): void => setEditTask(null)}
          onSubmit={(patch): Promise<void> => submitPatch(editTask.id, patch)}
        />
      ) : null}

      {assignTask !== null ? (
        <AssignOwnerModal
          task={assignTask}
          users={users}
          onClose={(): void => setAssignTask(null)}
          onSubmit={(ownerUserId): Promise<void> =>
            submitPatch(assignTask.id, { ownerUserId })
          }
        />
      ) : null}

      <Modal
        isOpen={deleteTask !== null}
        onClose={(): void => setDeleteTask(null)}
        title="Delete task"
        footer={
          <>
            <Button variant="secondary" onClick={(): void => setDeleteTask(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={(): void => {
                const target = deleteTask;
                setDeleteTask(null);
                if (target !== null) void rowDelete(target.id);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p style={TYPE.body}>
          This permanently deletes the task and cannot be undone. To keep it recoverable,
          close this and use Archive instead — archived tasks stay under “Show archived”.
        </p>
      </Modal>

      <Modal
        isOpen={bulkModal === 'delete'}
        onClose={(): void => setBulkModal(null)}
        title="Delete selected tasks"
        footer={
          <>
            <Button variant="secondary" disabled={bulkBusy} onClick={(): void => setBulkModal(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={bulkBusy} onClick={(): void => void runBulkDelete()}>
              {bulkBusy ? 'Deleting…' : `Delete ${selectedCount} task${selectedCount === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        <p style={TYPE.body}>
          Permanently delete {selectedCount} task{selectedCount === 1 ? '' : 's'}? This can’t be undone.
          To keep tasks recoverable, cancel and use Archive instead.
        </p>
      </Modal>

      <Modal
        isOpen={bulkModal === 'merge'}
        onClose={(): void => setBulkModal(null)}
        title="Merge tasks"
        footer={
          canMerge ? (
            <>
              <Button variant="secondary" disabled={bulkBusy} onClick={(): void => setBulkModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={bulkBusy} onClick={(): void => void runMerge()}>
                {bulkBusy ? 'Merging…' : `Merge ${selectedCount} into 1`}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={(): void => setBulkModal(null)}>
              Close
            </Button>
          )
        }
      >
        {!canMerge ? (
          <p style={TYPE.body}>
            {selectedCount < 2
              ? 'Select two or more tasks from the same client to merge.'
              : 'Merge only works within one client. These tasks belong to different clients — deselect tasks until only one client remains.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p style={TYPE.body}>
              Merge {selectedCount} tasks into one? The primary keeps its client; the others’
              descriptions and notes are folded into it, then they’re deleted. This can’t be undone.
            </p>
            <ul className="flex flex-col gap-1">
              {selectedTasks.map((task, index) => (
                <li key={task.id} className="flex items-center gap-2">
                  <Badge
                    bg={index === 0 ? 'var(--color-emerald-100)' : 'var(--color-slate-100)'}
                    fg={index === 0 ? 'var(--color-emerald-600)' : 'var(--color-slate-600)'}
                  >
                    {index === 0 ? 'Primary — kept' : 'Merged in'}
                  </Badge>
                  <span style={TYPE.secondary}>{task.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}

function TaskRow({
  task,
  editable,
  currentUserId,
  usersById,
  clientNamesById,
  selectable,
  selected,
  selectDisabled,
  onToggleSelect,
  busy,
  isExpanded,
  onToggleExpand,
  onPatch,
  onEdit,
  onAssign,
  onDelete,
}: {
  readonly task: Task;
  readonly editable: boolean;
  readonly currentUserId: string | null;
  readonly usersById: UsersById;
  readonly clientNamesById: ClientNamesById;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly selectDisabled: boolean;
  readonly onToggleSelect: () => void;
  readonly busy: boolean;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onPatch: (patch: Record<string, unknown>) => void;
  readonly onEdit: () => void;
  readonly onAssign: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const isComplete = task.status === 'complete';
  const urgency = taskUrgency(task.dueDate, isComplete, new Date());
  const tone = URGENCY_TONE[urgency];
  const priority = priorityBadge(task.hasPriorityFlag);

  // Viewers may toggle ONLY their own tasks; editors may toggle any task. A null
  // internal id (ownership unknown) never matches, so it fails closed.
  const isOwnTask = currentUserId !== null && task.ownerUserId === currentUserId;
  const canToggleComplete = !task.isArchived && (editable || isOwnTask);

  // Columns the expanded notes row spans: expander, status, task, client, owner, due,
  // priority, actions = 8, plus the leading select checkbox column for admins.
  const COLUMN_COUNT = selectable ? 9 : 8;

  return (
    <Fragment>
      <TRow tone={tone}>
        {selectable ? (
          <TCell style={{ width: '2.5rem' }}>
            <input
              type="checkbox"
              checked={selected}
              disabled={selectDisabled}
              onChange={onToggleSelect}
              aria-label={`Select "${task.description}"`}
              className="size-4 rounded border"
              style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
            />
          </TCell>
        ) : null}
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
            {clientName(clientNamesById, task.clientId)}
          </Badge>
        </TCell>
        <TCell>
          <span className="flex items-center gap-2">
            <ClientAvatar initials={displayInitials(usersById, task.ownerUserId)} size="sm" />
            <span style={TYPE.secondary}>{displayName(usersById, task.ownerUserId)}</span>
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
            {task.isArchived ? (
              editable ? (
                <RowAction
                  label={`Restore "${task.description}"`}
                  icon={<ArchiveRestore size={16} />}
                  title="Restore task"
                  disabled={busy}
                  onClick={(): void => onPatch({ archived: false })}
                />
              ) : null
            ) : (
              <>
                <RowAction
                  label={
                    isComplete
                      ? `Reopen "${task.description}"`
                      : `Mark "${task.description}" complete`
                  }
                  icon={isComplete ? <RotateCcw size={16} /> : <Check size={16} />}
                  disabled={!canToggleComplete || busy}
                  title={
                    canToggleComplete
                      ? isComplete
                        ? 'Reopen task'
                        : 'Mark complete'
                      : 'You can only complete your own tasks'
                  }
                  onClick={(): void => onPatch({ status: isComplete ? 'open' : 'complete' })}
                />
                {editable ? (
                  <>
                    <RowAction
                      label={`Edit "${task.description}"`}
                      icon={<Pencil size={16} />}
                      title="Edit task"
                      disabled={busy}
                      onClick={onEdit}
                    />
                    <RowAction
                      label={`Assign "${task.description}"`}
                      icon={<UserPlus size={16} />}
                      title="Assign owner"
                      disabled={busy}
                      onClick={onAssign}
                    />
                    <RowAction
                      label={`Archive "${task.description}"`}
                      icon={<Archive size={16} />}
                      title="Archive task"
                      disabled={busy}
                      onClick={(): void => onPatch({ archived: true })}
                    />
                    <RowAction
                      label={`Delete "${task.description}"`}
                      icon={<Trash2 size={16} />}
                      title="Delete task"
                      disabled={busy}
                      danger
                      onClick={onDelete}
                    />
                  </>
                ) : null}
              </>
            )}
          </span>
        </TCell>
      </TRow>
      {isExpanded ? (
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <td colSpan={COLUMN_COUNT} className="px-4 py-3" style={{ backgroundColor: 'var(--color-slate-100)' }}>
            <TaskNotes taskId={task.id} usersById={usersById} />
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
  const overdueDays = urgency === 'overdue' ? daysOverdue(task.dueDate, new Date()) : 0;
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

/** Edit a task's description, due date, and priority (editors only). */
function EditTaskModal({
  task,
  onClose,
  onSubmit,
}: {
  readonly task: Task;
  readonly onClose: () => void;
  readonly onSubmit: (patch: Record<string, unknown>) => Promise<void>;
}): React.JSX.Element {
  const [description, setDescription] = useState<string>(task.description);
  const [dueDate, setDueDate] = useState<string>(task.dueDate ?? '');
  const [priority, setPriority] = useState<boolean>(task.hasPriorityFlag);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const invalid = description.trim() === '';

  async function save(): Promise<void> {
    if (saving || invalid) return;
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit({
        description: description.trim(),
        dueDate: dueDate === '' ? null : dueDate,
        priorityFlag: priority,
      });
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit task"
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || invalid} onClick={(): void => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What needs to be done?"
          required
        />
        <TextField label="Due date" type="date" value={dueDate} onChange={setDueDate} />
        <label className="flex items-center gap-2" htmlFor="edit-task-priority">
          <input
            id="edit-task-priority"
            type="checkbox"
            checked={priority}
            onChange={(event): void => setPriority(event.target.checked)}
          />
          <span style={TYPE.body}>High priority</span>
        </label>
        <FormError message={formError} />
      </div>
    </Modal>
  );
}

/** Assign (or clear) a task's owner from the assignable-users list (editors only). */
function AssignOwnerModal({
  task,
  users,
  onClose,
  onSubmit,
}: {
  readonly task: Task;
  readonly users: readonly AssignableUser[];
  readonly onClose: () => void;
  readonly onSubmit: (ownerUserId: string | null) => Promise<void>;
}): React.JSX.Element {
  const [ownerId, setOwnerId] = useState<string>(task.ownerUserId ?? '');
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(ownerId === '' ? null : ownerId);
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to assign owner');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Assign owner"
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={(): void => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          label="Owner"
          value={ownerId}
          onChange={setOwnerId}
          options={[
            { value: '', label: 'Unassigned' },
            ...users.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        {users.length === 0 ? (
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            No users available to assign.
          </p>
        ) : null}
        <FormError message={formError} />
      </div>
    </Modal>
  );
}

function TaskNotes({
  taskId,
  usersById,
}: {
  readonly taskId: string;
  readonly usersById: UsersById;
}): React.JSX.Element {
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
          <ClientAvatar initials={displayInitials(usersById, note.authorUserId)} size="sm" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span style={TYPE.bodyStrong}>{displayName(usersById, note.authorUserId)}</span>
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

/** Header select-all checkbox — supports the indeterminate (some-selected) state via a ref. */
function SelectAllCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label="Select all tasks in the current filter"
      checked={checked}
      disabled={disabled}
      ref={(el): void => {
        if (el !== null) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      className="size-4 rounded border"
      style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
    />
  );
}

function RowAction({
  label,
  icon,
  onClick,
  disabled = false,
  title,
  danger = false,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1"
      style={{
        color: danger ? 'var(--color-red-600)' : 'var(--text-secondary)',
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
