/**
 * Editable daily-sync email template (DS). The 6 AM digest email's BODY is a
 * template of literal text + `{shortcode}` tokens; the fixed HTML shell (header /
 * footer / styling) stays locked in the worker so no one can break the email chrome
 * from a textarea. These are the SINGLE source shared by the worker (which maps each
 * shortcode to an HTML/text renderer) and the web Settings panel (which shows the
 * reference list + the effective template).
 *
 * The `{ai_brief}` shortcode is the optional AI-composed narrative — off by default,
 * grounded ONLY in our own assembled data (see the worker's daily-sync-ai). It's NOT
 * in the default template: an admin turns the AI on AND drops `{ai_brief}` where they
 * want it, so nothing changes until both deliberate actions are taken.
 */

export type DailySyncShortcode =
  | 'recipient_name'
  | 'sync_date'
  | 'yesterday_activity'
  | 'todays_meetings'
  | 'tomorrows_meetings'
  | 'team_out'
  | 'at_risk_clients'
  | 'pre_meeting_briefs'
  | 'last_week_todos'
  | 'ai_brief'
  | 'open_daily_sync_button';

export interface DailySyncShortcodeSpec {
  readonly code: DailySyncShortcode;
  /** Human label for the reference list. */
  readonly label: string;
  /** What it inserts (shown beside the template editor). */
  readonly description: string;
  /**
   * `inline` shortcodes expand to a short text string safe to embed mid-line (name,
   * date); `block` shortcodes expand to their own section and belong on their own line.
   */
  readonly kind: 'inline' | 'block';
}

/** The shortcode reference list (order = how it reads in the editor's legend). */
export const DAILY_SYNC_SHORTCODES: readonly DailySyncShortcodeSpec[] = [
  { code: 'recipient_name', label: 'Recipient name', description: "The staffer's name.", kind: 'inline' },
  { code: 'sync_date', label: 'Date', description: 'Long date, e.g. "Friday, July 10, 2026".', kind: 'inline' },
  { code: 'yesterday_activity', label: "Yesterday's activity", description: 'Meetings/documents/tasks rollup.', kind: 'block' },
  { code: 'todays_meetings', label: "Today's meetings", description: "The day's schedule.", kind: 'block' },
  { code: 'tomorrows_meetings', label: "Tomorrow's meetings", description: "The next day's schedule (so nothing's a surprise).", kind: 'block' },
  { code: 'team_out', label: 'Who is out today', description: 'Team members out / traveling (from calendar out-of-office). Needs the OOO feed.', kind: 'block' },
  { code: 'at_risk_clients', label: 'Clients to watch', description: 'At-risk clients by health score.', kind: 'block' },
  { code: 'pre_meeting_briefs', label: 'Pre-meeting briefs', description: 'The deterministic per-meeting briefs.', kind: 'block' },
  { code: 'last_week_todos', label: "Last week's to-dos", description: 'Open tasks from the last 7 days.', kind: 'block' },
  { code: 'ai_brief', label: "Gracie's AI briefing", description: 'AI narrative — needs the AI switch on. Composed only from your own data.', kind: 'block' },
  { code: 'open_daily_sync_button', label: 'Open Daily Sync button', description: 'Link button to the Daily Sync page.', kind: 'block' },
] as const;

export const DAILY_SYNC_SHORTCODE_CODES: readonly DailySyncShortcode[] = DAILY_SYNC_SHORTCODES.map((s) => s.code);

/**
 * The DEFAULT body template — reproduces today's email exactly (same sections, same
 * order). The new `{last_week_todos}` and `{ai_brief}` shortcodes are available in the
 * reference list but intentionally NOT here, so the out-of-the-box email is unchanged.
 */
export const DEFAULT_DAILY_SYNC_TEMPLATE = [
  'Good morning, {recipient_name}.',
  '',
  '{yesterday_activity}',
  '{todays_meetings}',
  '{at_risk_clients}',
  '{pre_meeting_briefs}',
  '{open_daily_sync_button}',
].join('\n');

/**
 * The DEFAULT `{ai_brief}` prompt. Leads with the hard grounding rule — the model is
 * fed ONLY the assembled facts (no web, no tools) and must not invent. Internal
 * staff audience.
 */
export const DEFAULT_AI_BRIEF_PROMPT = [
  'You are Gracie, writing the internal morning briefing for the Grace & Associates consulting team.',
  'Using ONLY the information provided below — today’s meetings, recent context from prior meetings,',
  'at-risk clients, and last week’s open to-dos — write a concise, well-organized briefing that helps',
  'the team prepare for the day. Connect each of today’s meetings to its relevant history, and surface',
  'the most important carried-over to-dos.',
  'Use ONLY the facts provided: do NOT add outside knowledge, and never invent names, numbers, dates, or',
  'commitments. Wrap anything uncertain in [VERIFY: …]. This is an internal briefing — be candid and',
  'practical. Use short Markdown-style headings and bullet points.',
].join(' ');

/** A non-blank string override, else the default. Defensive about type (→ default). */
function overrideOrDefault(override: unknown, fallback: string): string {
  return typeof override === 'string' && override.trim() !== '' ? override : fallback;
}

/** Resolve the effective email template from a stored override (blank/absent → default). */
export function resolveDailySyncTemplate(override: unknown): string {
  return overrideOrDefault(override, DEFAULT_DAILY_SYNC_TEMPLATE);
}

/** Resolve the effective AI-brief prompt from a stored override (blank/absent → default). */
export function resolveAiBriefPrompt(override: unknown): string {
  return overrideOrDefault(override, DEFAULT_AI_BRIEF_PROMPT);
}
