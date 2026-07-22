'use client';

import { useState } from 'react';
import { Archive, Check, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { Task, TaskStatus } from '@gracie/shared';
import { TASK_STATUSES } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDate } from '@/lib/format';
import { priorityBadge, taskStatusLabel } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/StateViews';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { FormError, SelectField, TextField } from '@/components/ui/Field';

/**
 * Client Operations → Tasks panel (P2.1). Read-only board for viewers; editors get
 * Add task plus per-row complete/reopen, edit, and archive. Manual creates go to
 * `POST /api/tasks`; edits to `PATCH /api/tasks/:id`. Local state updates from the
 * API response so the board reflects changes without a full reload. Pipeline-extracted
 * tasks are edited in place, same as manual ones.
 */
interface TaskDraft {
  readonly description: string;
  readonly dueDate: string;
  readonly status: TaskStatus;
  readonly priority: boolean;
}

const STATUS_OPTIONS = TASK_STATUSES.map((status) => ({
  value: status,
  label: taskStatusLabel(status),
}));

export function ClientTasksPanel({
  clientId,
  initialTasks,
  editable,
}: {
  readonly clientId: string;
  readonly initialTasks: readonly Task[];
  readonly editable: boolean;
}): React.JSX.Element {
  const [tasks, setTasks] = useState<readonly Task[]>(initialTasks);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Modal state — `editingId === null` while adding.
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>({ description: '', dueDate: '', status: 'open', priority: false });
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd(): void {
    setEditingId(null);
    setDraft({ description: '', dueDate: '', status: 'open', priority: false });
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(task: Task): void {
    setEditingId(task.id);
    setDraft({
      description: task.description,
      dueDate: task.dueDate ?? '',
      status: task.status,
      priority: task.hasPriorityFlag,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function upsertLocal(task: Task): void {
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === task.id);
      const next = exists ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task];
      return next.filter((t) => !t.isArchived);
    });
  }

  async function saveDraft(): Promise<void> {
    if (saving || draft.description.trim() === '') return;
    setSaving(true);
    setFormError(null);
    const body = {
      description: draft.description.trim(),
      dueDate: draft.dueDate === '' ? null : draft.dueDate,
      priorityFlag: draft.priority,
    };
    try {
      if (editingId === null) {
        const { task } = await apiClient.post<{ task: Task }>('/api/tasks', { clientId, ...body });
        upsertLocal(task);
      } else {
        const { task } = await apiClient.patch<{ task: Task }>(`/api/tasks/${editingId}`, {
          ...body,
          status: draft.status,
        });
        upsertLocal(task);
      }
      setModalOpen(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save task');
    } finally {
      setSaving(false);
    }
  }

  async function patchRow(task: Task, patch: Record<string, unknown>): Promise<void> {
    if (rowBusyId !== null) return;
    setRowBusyId(task.id);
    setRowError(null);
    try {
      const { task: updated } = await apiClient.patch<{ task: Task }>(`/api/tasks/${task.id}`, patch);
      upsertLocal(updated);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to update task');
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-start justify-between gap-4 p-6 pb-3">
        <CardHeader title="Client Tasks" description="All active tasks scoped to this client." />
        {editable ? (
          <Button variant="primary" size="sm" icon={<Plus aria-hidden="true" size={14} />} onClick={openAdd}>
            Add task
          </Button>
        ) : null}
      </div>

      {rowError !== null ? (
        <p role="alert" className="px-6 pb-2" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
          {rowError}
        </p>
      ) : null}

      {tasks.length === 0 ? (
        <div className="p-6 pt-0">
          <EmptyState title="No tasks" description="No active tasks for this client." />
        </div>
      ) : (
        <Table minWidth="44rem" scrollRegionLabel="Client tasks">
          <THead>
            <TH>Task</TH>
            <TH>Owner</TH>
            <TH>Due</TH>
            <TH>Status</TH>
            <TH>Priority</TH>
            {editable ? <TH>Actions</TH> : null}
          </THead>
          <TBody>
            {tasks.map((task) => {
              const badge = priorityBadge(task.hasPriorityFlag);
              const isComplete = task.status === 'complete';
              const busy = rowBusyId === task.id;
              return (
                <TRow key={task.id}>
                  <TCell>{task.description}</TCell>
                  <TCell>{getUserName(task.ownerUserId)}</TCell>
                  <TCell>{task.dueDate !== null ? formatDate(task.dueDate) : '—'}</TCell>
                  <TCell>{taskStatusLabel(task.status)}</TCell>
                  <TCell>
                    <Badge bg={badge.bg} fg={badge.fg}>
                      {badge.label}
                    </Badge>
                  </TCell>
                  {editable ? (
                    <TCell>
                      <div className="flex gap-1">
                        <IconAction
                          label={isComplete ? 'Reopen task' : 'Mark complete'}
                          disabled={busy}
                          color={isComplete ? 'var(--text-secondary)' : 'var(--color-emerald-600)'}
                          onClick={(): void =>
                            void patchRow(task, { status: isComplete ? 'open' : 'complete' })
                          }
                        >
                          {isComplete ? <RotateCcw aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
                        </IconAction>
                        <IconAction label="Edit task" disabled={busy} onClick={(): void => openEdit(task)}>
                          <Pencil aria-hidden="true" size={14} />
                        </IconAction>
                        <IconAction
                          label="Archive task"
                          disabled={busy}
                          color="var(--color-red-600)"
                          onClick={(): void => void patchRow(task, { archived: true })}
                        >
                          <Archive aria-hidden="true" size={14} />
                        </IconAction>
                      </div>
                    </TCell>
                  ) : null}
                </TRow>
              );
            })}
          </TBody>
        </Table>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={(): void => setModalOpen(false)}
        title={editingId === null ? 'Add task' : 'Edit task'}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={(): void => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || draft.description.trim() === ''}
              onClick={(): void => void saveDraft()}
            >
              {saving ? 'Saving…' : editingId === null ? 'Add task' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label="Description"
            value={draft.description}
            onChange={(value): void => setDraft((d) => ({ ...d, description: value }))}
            placeholder="What needs to be done?"
            required
          />
          <TextField
            label="Due date"
            type="date"
            value={draft.dueDate}
            onChange={(value): void => setDraft((d) => ({ ...d, dueDate: value }))}
          />
          {editingId !== null ? (
            <SelectField
              label="Status"
              value={draft.status}
              onChange={(value): void => setDraft((d) => ({ ...d, status: value as TaskStatus }))}
              options={STATUS_OPTIONS}
            />
          ) : null}
          <label className="flex items-center gap-2" htmlFor="task-priority">
            <input
              id="task-priority"
              type="checkbox"
              checked={draft.priority}
              onChange={(event): void => setDraft((d) => ({ ...d, priority: event.target.checked }))}
            />
            <span style={TYPE.body}>High priority</span>
          </label>
          <FormError message={formError} />
        </div>
      </Modal>
    </Card>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  color = 'var(--text-secondary)',
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly color?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5"
      style={{ color, background: 'transparent', cursor: disabled === true ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  );
}
