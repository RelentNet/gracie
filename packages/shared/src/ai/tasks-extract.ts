/**
 * Task-extraction parser/validator (docs/06 §6). The Task Checklist generation
 * step returns JSON; this validates and normalizes it into a TaskExtractionResult
 * before the pipeline writes `tasks` rows. On invalid input the pipeline does one
 * stricter re-ask, then (if still invalid) stores the checklist doc and skips the
 * task insert (docs/06 §8) — so this throws a typed error callers can catch.
 *
 * Input JSON shape (docs/06 §6):
 *   { "tasks": [ { "description", "owner_hint", "due_hint", "priority" } ] }
 */
import type { ExtractedTask, TaskExtractionResult } from '../types/task.js';

export class TaskExtractionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TaskExtractionError';
  }
}

/** Trimmed non-empty string, else null. */
function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeTask(value: unknown, index: number): ExtractedTask {
  if (typeof value !== 'object' || value === null) {
    throw new TaskExtractionError(`tasks[${index}] is not an object`);
  }
  const record = value as Record<string, unknown>;
  const description = asNullableString(record.description);
  if (description === null) {
    throw new TaskExtractionError(`tasks[${index}].description is missing or empty`);
  }
  return {
    description,
    ownerHint: asNullableString(record.owner_hint),
    dueHint: asNullableString(record.due_hint),
    priority: record.priority === true,
  };
}

/** Strip a ```json … ``` fence if the model wrapped its output in one. */
function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

/**
 * Parse and validate the model's task-checklist output. Throws
 * TaskExtractionError on any structural problem.
 */
export function parseTaskExtraction(content: string): TaskExtractionResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(content));
  } catch {
    throw new TaskExtractionError('response is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new TaskExtractionError('expected a JSON object');
  }
  const tasks = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    throw new TaskExtractionError('expected a "tasks" array');
  }
  return { tasks: tasks.map((task, index) => normalizeTask(task, index)) };
}
