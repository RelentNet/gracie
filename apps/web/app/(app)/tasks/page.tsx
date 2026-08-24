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
import type { Client, Task, TaskNote } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDate, formatDateTime } from '@/lib/format';
import { canSeeTaskBoard, priorityBadge } from '@/lib/client-display';
import {
  clientWithLatestMeeting,
  groupTasksByMeetingDate,
  mostRecentMeetingKey,
  NO_MEETING_KEY,
  taskColor,
  type MeetingDateGroup,
} from '@/lib/tasks-board';
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
 * Task Board — per-client, last-meeting view (Allie's Aug-21 redesign).
 *
 * The old cross-client owner/due-date grid was "a nightmare". This is a focused,
 * minimal view: TWO dropdowns drive it — pick a CLIENT, then a MEETING DATE
 * (default = the most recent meeting → "top items from the last meeting"; pick an
 * earlier date to look back). Columns are just the task, its priority, and the
 * source-meeting date — owner and due-date are gone. Completed tasks read GREEN.
 *
 * Built ON the existing task lifecycle, not around it:
 *   - #106 aging/archive: standard tasks self-archive after two weeks, high tasks
 *     persist. This view doesn't re-implement any of that — "Show archived" surfaces
 *     the archived "cache" for the selected client; the default stays current tasks.
 *   - #122 visibility: admin-only (`task.manageBoard`) until the operator reveals it
 *     to all (`taskBoardVisibleToAll`). Same gate as the nav item + list/export APIs.
 *   - #123 bulk: admins keep multi-select → Merge / Mass-delete on the visible rows.
 *
 * ROLE RULES (docs/08 §7, D14) unchanged:
 *   - Edit / Assign / Archive / Delete render ONLY for editors (`canEdit()`).
 *   - "Mark Complete" / "Reopen": editors may toggle ANY task; viewers only their OWN.
 *
 * Tasks come from `GET /api/tasks`, now enriched with each task's source-meeting
 * `date_time` (`sourceMeetingAt`) so grouping-by-meeting works without a second fetch.
 * The archived toggle re-fetches with `?archived=true`.
 */

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

/** Dropdown value for a group: its date key, or the no-meeting sentinel. */
function groupKeyOf(group: MeetingDateGroup): string {
  return group.dateKey ?? NO_MEETING_KEY;
}

/** Human label for a meeting-date group (dropdown + header). */
function groupLabel(group: MeetingDateGroup): string {
  const count = `${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'}`;
  if (group.meetingAt === null) return `Other tasks (no meeting) · ${count}`;
  return `${formatDate(group.meetingAt)} · ${count}`;
}

export default function TasksPage(): React.JSX.Element {
  const { can, taskBoardVisibleToAll } = useAuth();

  // The Task Board is an admin triage surface by default. The operator can reveal it to
  // everyone via the Settings → Company toggle (`taskBoardVisibleToAll`); the same rule
  // gates the nav item and the list/export APIs. This thin wrapper keeps TaskBoard's hooks
  // unconditional, and the gate never 500s — it renders a placeholder.
  if (!canSeeTaskBoard(can('task.manageBoard'), taskBoardVisibleToAll)) {
    return (
      <PageContainer>
        <PagePlaceholder
          title="Task Board"
          description="Per-client task triage."
          emptyTitle="Not available yet"
          emptyDescription="The Task Board isn't open to your account yet. Tasks for each client appear on that client's Tasks panel, where you can complete and archive them. An administrator can turn the board on for everyone in Settings → Company."
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

  // The two dropdowns that drive the whole view. `clientId` empty = not yet picked
  // (auto-selected once tasks load); `dateKey` null = follow the default (most recent).
  const [clientId, setClientId] = useState<string>('');
  const [dateKey, setDateKey] = useState<string | null>(null);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Modals (page-level so a single instance renders; null = closed).
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [assignTask, setAssignTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);

  // Bulk multi-select (admin only). Selection is an id set, always intersected with the
  // *visible* rows so an action never touches a task outside the current meeting group.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [bulkModal, setBulkModal] = useState<'delete' | 'merge' | null>(null);

  // Active-only by default; the archived toggle re-fetches with ?archived=true (the #106
  // "cache" of aged-out tasks for the selected client).
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

  // Real client roster drives the client names + picker (replaces the mock resolver).
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

  // Clients that actually have tasks in the current set drive the Client dropdown.
  const clientOptions = useMemo<readonly string[]>(
    () =>
      Array.from(new Set(baseTasks.map((task) => task.clientId))).sort((a, b) =>
        clientName(clientNamesById, a).localeCompare(clientName(clientNamesById, b)),
      ),
    [baseTasks, clientNamesById],
  );

  // Auto-pick the client we last met with (falls back to the first client) once tasks
  // land, so the board opens on something useful instead of an empty picker. Runs only
  // while nothing is selected — a later user choice is never overridden.
  useEffect(() => {
    if (clientId !== '' || tasks === null) return;
    const pick = clientWithLatestMeeting(baseTasks) ?? clientOptions[0] ?? '';
    if (pick !== '') setClientId(pick);
  }, [tasks, clientId, baseTasks, clientOptions]);

  // The selected client's tasks, grouped by source-meeting date (newest first).
  const groups = useMemo<readonly MeetingDateGroup[]>(
    () => groupTasksByMeetingDate(baseTasks.filter((task) => task.clientId === clientId)),
    [baseTasks, clientId],
  );

  // Default meeting = most recent; `dateKey` (a user pick) overrides it when still valid.
  const defaultKey = useMemo<string | null>(
    () => mostRecentMeetingKey(groups) ?? (groups[0] ? groupKeyOf(groups[0]) : null),
    [groups],
  );
  const activeKey = dateKey ?? defaultKey;
  const selectedGroup = useMemo<MeetingDateGroup | null>(
    () => groups.find((g) => groupKeyOf(g) === activeKey) ?? groups[0] ?? null,
    [groups, activeKey],
  );

  // The visible rows = the selected meeting's tasks.
  const filteredTasks = selectedGroup?.tasks ?? [];
  const completeCount = useMemo<number>(
    () => filteredTasks.filter((task) => task.status === 'complete').length,
    [filteredTasks],
  );

  // Reset the meeting pick + selection when the client or archived scope changes, so a
  // stale date from another client can't stick.
  useEffect(() => {
    setDateKey(null);
    setSelectedIds(new Set());
  }, [clientId, showArchived]);

  // Merge an updated task back into the board. When archived tasks are hidden, a task
  // that just became archived (Archive/Delete) drops out of view.
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

  // Quick row action (complete/reopen/archive/restore): one row at a time.
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

  // Hard delete (admin-only): permanently removes the task, then drops it from the board.
  // Archive stays the recoverable path; this is the permanent one.
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
  // The board is per-client, so a merge is always within one client already.
  const canMerge = selectedCount >= 2;

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

  // Merge the selected tasks into the first (primary): fold the others in, then drop them
  // and replace the primary with the returned survivor — all in place.
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
        prev === null
          ? prev
          : prev.filter((t) => !removed.has(t.id)).map((t) => (t.id === task.id ? task : t)),
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

  const selectedClientName = clientId === '' ? '' : clientName(clientNamesById, clientId);

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Task Board</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {tasks === null
              ? 'Loading tasks…'
              : selectedGroup === null
                ? 'Pick a client to see their latest meeting’s tasks.'
                : `${selectedClientName} · ${
                    selectedGroup.meetingAt === null
                      ? 'other tasks'
                      : formatDate(selectedGroup.meetingAt)
                  } · ${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}${
                    completeCount > 0 ? ` · ${completeCount} done` : ''
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
        <LabeledSelect
          label="Client"
          value={clientId}
          onChange={setClientId}
          placeholder={clientOptions.length === 0 ? 'No clients with tasks' : 'Select a client…'}
          options={clientOptions.map((id) => ({ value: id, label: clientName(clientNamesById, id) }))}
        />
        <LabeledSelect
          label="Meeting"
          value={activeKey ?? ''}
          onChange={(value): void => setDateKey(value)}
          placeholder="No meetings"
          disabled={groups.length === 0}
          options={groups.map((group) => ({ value: groupKeyOf(group), label: groupLabel(group) }))}
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
          <span style={TYPE.bodyStrong}>{selectedCount} selected</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkBusy || selectedCount < 2}
              title={
                selectedCount < 2 ? 'Select 2 or more tasks to merge' : 'Merge the selected tasks into one'
              }
              onClick={(): void => setBulkModal('merge')}
            >
              Merge
            </Button>
            <Button variant="danger" size="sm" disabled={bulkBusy} onClick={(): void => setBulkModal('delete')}>
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
      ) : clientOptions.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Tasks appear here once meetings are processed. Nothing to triage right now."
        />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="No tasks for this meeting"
          description="This client has no tasks for the selected meeting. Pick another meeting, or turn on “Show archived” to see aged-out tasks."
        />
      ) : (
        <Table minWidth="42rem" scrollRegionLabel="Task board">
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
            <TH>Task</TH>
            <TH>Priority</TH>
            <TH>Meeting</TH>
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
                usersById={usersById}
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
          onSubmit={(ownerUserId): Promise<void> => submitPatch(assignTask.id, { ownerUserId })}
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
          <p style={TYPE.body}>Select two or more tasks to merge.</p>
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
  usersById,
}: {
  readonly task: Task;
  readonly editable: boolean;
  readonly currentUserId: string | null;
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
  readonly usersById: UsersById;
}): React.JSX.Element {
  const isComplete = task.status === 'complete';
  // Completed tasks read green; open/in-progress stay neutral (color state, tasks-board).
  const tone = taskColor(task) === 'complete' ? 'success' : 'default';
  const priority = priorityBadge(task.hasPriorityFlag);

  // Viewers may toggle ONLY their own tasks; editors may toggle any task. A null internal
  // id (ownership unknown) never matches, so it fails closed.
  const isOwnTask = currentUserId !== null && task.ownerUserId === currentUserId;
  const canToggleComplete = !task.isArchived && (editable || isOwnTask);

  // Columns the expanded notes row spans: expander, task, priority, meeting, actions = 5,
  // plus the leading select checkbox column for admins.
  const COLUMN_COUNT = selectable ? 6 : 5;

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
          <span className="flex items-center gap-2">
            {isComplete ? (
              <Badge bg="var(--color-emerald-100)" fg="var(--color-emerald-600)">
                Done
              </Badge>
            ) : null}
            <span style={TYPE.bodyStrong}>{task.description}</span>
          </span>
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
          {task.sourceMeetingAt != null ? (
            <span style={TYPE.secondary}>{formatDate(task.sourceMeetingAt)}</span>
          ) : (
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No meeting</span>
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
                    isComplete ? `Reopen "${task.description}"` : `Mark "${task.description}" complete`
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
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No notes on this task yet.</p>
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
      aria-label="Select all tasks in the current meeting"
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

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * A labelled dropdown for the two board drivers (Client, Meeting). Unlike the old
 * filter select it has NO injected "All" option — the board is per-client, one
 * meeting at a time. An empty value shows the placeholder.
 */
function LabeledSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event): void => onChange(event.target.value)}
        className="rounded-lg border bg-white px-3 py-2"
        style={{ borderColor: 'var(--border-subtle)', ...TYPE.body, minWidth: '14rem' }}
      >
        {value === '' ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
