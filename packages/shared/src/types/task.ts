import type { TaskStatus } from '../constants/enums.js';
import type { ISODate, ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * `tasks` table (docs/04). `daysOverdue` is COMPUTED in queries (due_date vs
 * now), never stored — so it is intentionally absent from this row type.
 */
export interface Task extends Timestamps {
  readonly id: UUID;
  readonly clientId: UUID;
  readonly sourceMeetingId: UUID | null;
  readonly sourceDocumentId: UUID | null;
  readonly description: string;
  readonly ownerUserId: UUID | null;
  readonly dueDate: ISODate | null;
  readonly status: TaskStatus;
  readonly hasPriorityFlag: boolean;
  readonly isArchived: boolean;
}

/** `task_notes` table — append-only note feed on a task. */
export interface TaskNote {
  readonly id: UUID;
  readonly taskId: UUID;
  readonly authorUserId: UUID | null;
  readonly content: string;
  readonly createdAt: ISOTimestamp;
}

/**
 * Structured task-extraction contract (docs/06 §6). The Task Checklist step
 * requests JSON matching this shape before writing rows.
 */
export interface ExtractedTask {
  readonly description: string;
  /** Name/role mentioned; resolved to ownerUserId if matchable, else null. */
  readonly ownerHint: string | null;
  /** Natural-language due; parsed to a date when unambiguous, else null. */
  readonly dueHint: string | null;
  readonly priority: boolean;
}

export interface TaskExtractionResult {
  readonly tasks: readonly ExtractedTask[];
}
