/**
 * Daily-sync + pre-meeting-brief content contracts (P7). The worker's daily-sync
 * processor WRITES `daily_syncs.content` in this shape; the web Daily Sync page
 * READS it. Kept here (client-safe, no I/O) so both sides agree on one structure.
 *
 * `pre_meeting_briefs.content` is a plain markdown/text string (not structured) —
 * the brief's per-meeting body; the daily-sync email + page render it inline and a
 * per-meeting view can show it standalone.
 */

/** Yesterday's activity rollup shown at the top of the sync. */
export interface DailySyncYesterday {
  readonly meetingsProcessed: number;
  readonly documentsGenerated: number;
  readonly tasksCreated: number;
  readonly tasksCompleted: number;
}

/** One of today's scheduled meetings in the sync's "Today" section. */
export interface DailySyncMeeting {
  readonly meetingId: string;
  readonly title: string;
  /** Scheduled start (ISO/UTC); the UI renders it in Eastern time. */
  readonly timeIso: string;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly isInternal: boolean;
  readonly leadName: string | null;
  /** Whether a pre-meeting brief was generated for this meeting. */
  readonly hasBrief: boolean;
}

/** An at-risk client (low or declining relationship health). */
export interface DailySyncAtRiskClient {
  readonly clientId: string;
  readonly name: string;
  readonly health: number | null;
  readonly trend: string | null;
}

/** A pre-meeting brief bundled into the sync (markdown/text body). */
export interface DailySyncBrief {
  readonly meetingId: string;
  readonly title: string;
  readonly clientName: string | null;
  readonly content: string;
  /** Owning client id — powers the email brief card's "Client page" link. Optional so older stored rows read back. */
  readonly clientId?: string | null;
}

/** An open to-do carried over from the last 7 days (the `{last_week_todos}` shortcode). */
export interface DailySyncTodo {
  readonly description: string;
  readonly clientName: string | null;
  readonly dueDate: string | null;
  readonly priority: boolean;
}

/**
 * The structured payload stored in `daily_syncs.content` (jsonb). `aiBrief` and
 * `lastWeekTodos` are OPTIONAL (added by DS) so older stored rows read back fine —
 * absent → the shortcode renders empty / the list is treated as none.
 */
export interface DailySyncContent {
  /** Schema version — bump if the shape changes so the reader can adapt. */
  readonly version: 1;
  readonly generatedAtIso: string;
  readonly yesterday: DailySyncYesterday;
  readonly todayMeetings: readonly DailySyncMeeting[];
  /** Tomorrow's schedule (the `{tomorrows_meetings}` shortcode). Optional so older stored rows read back — absent → the section is empty. */
  readonly tomorrowMeetings?: readonly DailySyncMeeting[];
  readonly atRiskClients: readonly DailySyncAtRiskClient[];
  readonly briefs: readonly DailySyncBrief[];
  /** Open to-dos from the last 7 days (deterministic; the `{last_week_todos}` shortcode). */
  readonly lastWeekTodos?: readonly DailySyncTodo[];
  /** The optional AI-composed narrative (`{ai_brief}`); null/absent when disabled or the compose failed. */
  readonly aiBrief?: string | null;
}
