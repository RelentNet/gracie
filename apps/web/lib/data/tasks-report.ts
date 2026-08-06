/**
 * PURE task-reporting helpers — the query filter behind the Assistant's `list_tasks`
 * tool and the CSV shaping behind `GET /api/tasks/export`.
 *
 * No `server-only`, no data access, no React — only `import type` (erased at build).
 * Kept dependency-light and total so the same functions the app runs are the ones the
 * `tasks-report.test.ts` self-checks exercise (mirrors assistant/company/access-policy.ts).
 */
import type { Task, TaskStatus } from '@gracie/shared';

import { taskStatusLabel } from '../client-display.js';

const MS_PER_DAY = 86_400_000;

/**
 * How to narrow a task list. Every field is optional and ANDed together; an absent
 * field means "don't filter on this". `ownerUserId: null` selects UNASSIGNED tasks
 * (distinct from omitting the key, which matches any owner).
 */
export interface TaskFilter {
  readonly status?: TaskStatus;
  /** Only tasks past their due date and not complete. */
  readonly overdue?: boolean;
  readonly clientId?: string;
  /** A user id to match, or `null` for unassigned. Omit for any owner. */
  readonly ownerUserId?: string | null;
  /** Only tasks created OR updated within the last N days (e.g. 7 = last week). */
  readonly recentDays?: number;
}

/**
 * Filter tasks by client / owner / status / overdue / recency. `now` is injected so
 * the function is deterministic (and testable). Overdue compares date-only strings;
 * recency matches when EITHER createdAt or updatedAt falls inside the window.
 */
export function filterTasks(tasks: readonly Task[], filter: TaskFilter, now: Date): Task[] {
  const today = now.toISOString().slice(0, 10);
  const recencyCutoff =
    filter.recentDays !== undefined && filter.recentDays > 0
      ? now.getTime() - filter.recentDays * MS_PER_DAY
      : null;

  return tasks.filter((task) => {
    if (filter.status !== undefined && task.status !== filter.status) return false;
    if (
      filter.overdue === true &&
      !(task.dueDate !== null && task.dueDate < today && task.status !== 'complete')
    ) {
      return false;
    }
    if (filter.clientId !== undefined && task.clientId !== filter.clientId) return false;
    // `ownerUserId` in the filter: null matches unassigned; a string matches that owner.
    if (filter.ownerUserId !== undefined && task.ownerUserId !== filter.ownerUserId) return false;
    if (recencyCutoff !== null) {
      const touched = Math.max(Date.parse(task.createdAt), Date.parse(task.updatedAt));
      if (Number.isFinite(touched) && touched < recencyCutoff) return false;
    }
    return true;
  });
}

// --- CSV export ---------------------------------------------------------------

/** Quote a CSV cell when it contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Column order for the tasks export — mirrors the Task Board. */
export const TASK_CSV_HEADER = [
  'Client',
  'Description',
  'Owner',
  'Priority',
  'Status',
  'Created',
  'Updated',
  'Due date',
] as const;

/**
 * Shape tasks into a `text/csv` string. Client and owner ids are resolved through the
 * supplied name maps (unknown org → "Internal", matching the board; no owner →
 * "Unassigned", unknown owner id → "Unknown"). Created/updated render as dates.
 */
export function tasksToCsv(
  tasks: readonly Task[],
  clientNames: ReadonlyMap<string, string>,
  ownerNames: ReadonlyMap<string, string>,
): string {
  const lines = [TASK_CSV_HEADER.map((h) => csvCell(h)).join(',')];
  for (const task of tasks) {
    const owner =
      task.ownerUserId === null ? 'Unassigned' : (ownerNames.get(task.ownerUserId) ?? 'Unknown');
    const row = [
      clientNames.get(task.clientId) ?? 'Internal',
      task.description,
      owner,
      task.hasPriorityFlag ? 'High' : 'Normal',
      taskStatusLabel(task.status),
      task.createdAt.slice(0, 10),
      task.updatedAt.slice(0, 10),
      task.dueDate ?? '',
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
