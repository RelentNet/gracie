/**
 * Pure view/grouping logic for the per-client, last-meeting Task Board
 * (Allie's Aug-21 redesign). No React, no data access — just the shaping the
 * board renders, so it stays testable (`tasks-board.test.ts`).
 *
 * The board is per-client: pick a client, then look at ONE meeting's tasks at a
 * time (default = the most recent meeting — "top items from the last meeting").
 * Tasks are bucketed by the LOCAL date of their source meeting (`sourceMeetingAt`,
 * the joined `meetings.date_time`); tasks with no source meeting fall into a
 * trailing `null` bucket so a client's manual/document tasks stay reachable.
 */
import type { Task } from '@gracie/shared';

/** A meeting-date bucket of a client's tasks. */
export interface MeetingDateGroup {
  /** Local `YYYY-MM-DD` key (sortable), or null for tasks with no source meeting. */
  readonly dateKey: string | null;
  /** Representative meeting timestamp (the latest in the bucket), or null. */
  readonly meetingAt: string | null;
  readonly tasks: readonly Task[];
}

/** Sentinel dropdown value for the trailing "no source meeting" bucket. */
export const NO_MEETING_KEY = '__none__';

/**
 * Local (device-zone) `YYYY-MM-DD` for an ISO timestamp. `en-CA` yields ISO
 * order so the string sorts chronologically. Pass an explicit IANA `zone` for a
 * deterministic result (tests use `'UTC'`); omit it to use the device zone,
 * matching how the board displays meeting dates.
 */
export function localDateKey(iso: string, zone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Group a set of tasks (already narrowed to one client) by their source-meeting
 * local date. Dated buckets come first, newest meeting → oldest; the no-meeting
 * bucket (if any) trails last.
 */
export function groupTasksByMeetingDate(
  tasks: readonly Task[],
  zone?: string,
): readonly MeetingDateGroup[] {
  const dated = new Map<string, Task[]>();
  const undated: Task[] = [];

  for (const task of tasks) {
    const at = task.sourceMeetingAt ?? null;
    if (at === null) {
      undated.push(task);
      continue;
    }
    const key = localDateKey(at, zone);
    const bucket = dated.get(key);
    if (bucket === undefined) dated.set(key, [task]);
    else bucket.push(task);
  }

  const groups: MeetingDateGroup[] = Array.from(dated.entries())
    .map(([dateKey, bucketTasks]) => ({
      dateKey,
      // Latest timestamp in the day is the representative (label + sort tiebreak).
      meetingAt: bucketTasks.reduce<string | null>((latest, t) => {
        const at = t.sourceMeetingAt ?? null;
        if (at === null) return latest;
        return latest === null || at > latest ? at : latest;
      }, null),
      tasks: bucketTasks,
    }))
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

  if (undated.length > 0) {
    groups.push({ dateKey: null, meetingAt: null, tasks: undated });
  }
  return groups;
}

/** The most recent dated meeting key in a grouped set, or null when none is dated. */
export function mostRecentMeetingKey(groups: readonly MeetingDateGroup[]): string | null {
  return groups.find((g) => g.dateKey !== null)?.dateKey ?? null;
}

/**
 * The client id whose most recent source-meeting task is newest across the set —
 * the board's default selection ("the client you last met with"). Null when no
 * task is meeting-linked.
 */
export function clientWithLatestMeeting(tasks: readonly Task[]): string | null {
  let bestClient: string | null = null;
  let bestAt: string | null = null;
  for (const task of tasks) {
    const at = task.sourceMeetingAt ?? null;
    if (at === null) continue;
    if (bestAt === null || at > bestAt) {
      bestAt = at;
      bestClient = task.clientId;
    }
  }
  return bestClient;
}

export type TaskColor = 'complete' | 'neutral';

/** Row color state: completed tasks read green, everything else neutral. */
export function taskColor(task: Task): TaskColor {
  return task.status === 'complete' ? 'complete' : 'neutral';
}
