/**
 * Automation domain types + PURE schedule math (P8). Client-safe (no Node-only or
 * `bullmq` imports) — shared by the web agentic layer, the API routes, and the
 * worker engine so all three agree on the schedule/recipients/params contract.
 *
 * The schedule helpers are DST-safe via `Intl` (no date library), mirroring the
 * daily-sync processor's ET wall-clock approach. `kind` covers the shapes a
 * non-technical chat request actually produces — a one-off, a raw interval, and
 * ET-anchored daily/weekly ("every morning", "every Monday") — in place of raw
 * cron strings the user would never author.
 */
import { AUTOMATION_TYPES, type AutomationType } from '../constants/enums.js';

const ET = 'America/New_York';

// --- schedule -----------------------------------------------------------------

/** A one-off run at a specific instant (then the automation is done → cancelled). */
export interface OnceSchedule {
  readonly kind: 'once';
  /** ISO instant to run at. If in the past at activation, it runs on the next sweep. */
  readonly runAt: string;
}

/** A fixed-interval repeat (e.g. every 720 minutes). */
export interface IntervalSchedule {
  readonly kind: 'interval';
  /** Minutes between runs (bounded ≥ 60 by validation — no sub-hourly automations). */
  readonly everyMinutes: number;
}

/** Once per day at an ET wall-clock time ("every morning at 7"). */
export interface DailySchedule {
  readonly kind: 'daily';
  /** Hour of day in ET, 0–23. */
  readonly hourEt: number;
  /** Minute of hour, 0–59 (default 0). */
  readonly minuteEt?: number;
}

/** Once per week on an ET weekday at an ET wall-clock time ("every Monday at 9"). */
export interface WeeklySchedule {
  readonly kind: 'weekly';
  /** 0=Sunday … 6=Saturday (matches `Date.getUTCDay`). */
  readonly weekday: number;
  readonly hourEt: number;
  readonly minuteEt?: number;
}

/**
 * Which of the OWNER's meetings an event trigger fires for (P8.1). All optional and
 * AND-combined. The trigger is always scoped to the owner's own client meetings (a
 * `meeting_brief` needs a client, and "brief ME" means the owner's meetings — the
 * worker restricts candidates to meetings the owner leads or attends). These filters
 * narrow that set further.
 */
export interface EventFilters {
  /** Only meetings the owner LEADS (default: any meeting the owner leads or attends). */
  readonly meetingsILead?: boolean;
  /** Only meetings for this specific client (`clients.id`). */
  readonly clientId?: string;
}

/**
 * An EVENT-driven trigger (P8.1) — "run X a set time before each of my meetings".
 * Not interval/wall-clock: `next_run_at` does NOT apply (the worker's event pass
 * scans upcoming meetings each sweep and fires per (automation, meeting) at most
 * once). v1 supports the single `before_meeting` event.
 */
export interface EventSchedule {
  readonly kind: 'event';
  readonly event: 'before_meeting';
  /** How many minutes before each matching meeting to run (bounded by validation). */
  readonly leadMinutes: number;
  readonly filters: EventFilters;
  /** Cached client label for display when `filters.clientId` is set (not used for logic). */
  readonly clientName?: string;
}

export type AutomationSchedule =
  | OnceSchedule
  | IntervalSchedule
  | DailySchedule
  | WeeklySchedule
  | EventSchedule;

/**
 * Absolute STRUCTURAL floor for a recurring interval (minutes) — the ~5-min
 * automations sweep cadence. Baked into {@link parseSchedule} so a per-minute
 * automation is impossible even from hand-crafted JSON, independent of the tunable
 * policy floor below.
 */
export const ABSOLUTE_MIN_INTERVAL_MINUTES = 5;

/**
 * Default configurable interval floor (minutes) when `settings.automations_min_interval_minutes`
 * is unset — hourly. The Assistant reads the setting and passes it to
 * {@link parseSchedule} at create time; an admin can tune it down (e.g. to 30) via SQL.
 */
export const DEFAULT_MIN_INTERVAL_MINUTES = 60;

/**
 * Bounds for an event trigger's lead time (minutes): from the sweep cadence up to 4
 * hours. The upper bound keeps a "brief me before each meeting" trigger a genuine
 * pre-meeting nudge (a whole-day lead is a scheduled digest, not an event) and bounds
 * how many already-in-window meetings a freshly-activated automation fires at once.
 */
export const MIN_EVENT_LEAD_MINUTES = ABSOLUTE_MIN_INTERVAL_MINUTES;
export const MAX_EVENT_LEAD_MINUTES = 240;

// --- recipients + params ------------------------------------------------------

/**
 * Delivery targets. Internal delivery (`userIds` → in-app + email, `emails` →
 * allowlist-gated email) is always safe. `externalEmails` is the customer-contact
 * exception — only ever populated for `client_send`, only ever delivered through
 * the admin-gated, explicitly-confirmed path, and always audited.
 */
export interface AutomationRecipients {
  /** Internal `users.id`s — receive an in-app notification (+ email if they have one). */
  readonly userIds?: readonly string[];
  /** Explicit internal addresses (still filtered to the GA allowlist on send). */
  readonly emails?: readonly string[];
  /** EXTERNAL addresses (client_send only) — gated + audited; never emailed otherwise. */
  readonly externalEmails?: readonly string[];
}

/** Per-client summary parameters. */
export interface ClientReportParams {
  readonly clientId: string;
  /** Cached display name (for the proposal/list without a re-lookup). */
  readonly clientName?: string;
}

/** Activity rollup window. */
export interface ActivityDigestParams {
  readonly window?: 'yesterday' | 'today' | 'both';
}

/** A scheduled nudge to internal users. */
export interface ReminderParams {
  readonly message: string;
}

/**
 * A pre-meeting brief for a specific upcoming meeting (P8.1). The meeting is chosen
 * by the event trigger at run time, not stored here — so the params are just delivery
 * knobs. `notifyAttendees` (default true) also delivers to the meeting's internal
 * attendees + lead; false delivers to the owner (and any configured recipients) only.
 */
export interface MeetingBriefParams {
  readonly notifyAttendees?: boolean;
}

/** The gated external client message. */
export interface ClientSendParams {
  readonly clientId?: string;
  readonly clientName?: string;
  readonly subject: string;
  readonly body: string;
}

// --- ET helpers (DST-safe via Intl; pure) -------------------------------------

/** The ET calendar date (YYYY-MM-DD) for an instant. */
function easternDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Milliseconds to add to an ET wall-clock to reach the UTC instant (the offset). */
function easternOffsetMs(at: Date): number {
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const et = new Date(at.toLocaleString('en-US', { timeZone: ET }));
  return utc.getTime() - et.getTime();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The UTC instant for `hourEt:minuteEt` ET on the given ET calendar date. */
function etWallClockUtc(etDate: string, hourEt: number, minuteEt: number): Date {
  // Approximate the offset at noon of that ET date so a midnight-adjacent DST
  // change never mis-resolves the target hour.
  const offset = easternOffsetMs(new Date(`${etDate}T12:00:00Z`));
  const base = Date.parse(`${etDate}T${pad2(hourEt)}:${pad2(minuteEt)}:00Z`);
  return new Date(base + offset);
}

/** Weekday (0=Sun … 6=Sat) of an ET calendar date. */
function etWeekday(etDate: string): number {
  return new Date(`${etDate}T12:00:00Z`).getUTCDay();
}

/** Add whole days to an instant and return the resulting ET calendar date. */
function etDateAfter(from: Date, days: number): string {
  return easternDateString(new Date(from.getTime() + days * 86_400_000));
}

/** Next ET daily occurrence strictly after `from`. */
function nextDaily(hourEt: number, minuteEt: number, from: Date): Date {
  const today = etWallClockUtc(easternDateString(from), hourEt, minuteEt);
  if (today.getTime() > from.getTime()) return today;
  return etWallClockUtc(etDateAfter(from, 1), hourEt, minuteEt);
}

/** Next ET weekly occurrence (on `weekday`) strictly after `from`. */
function nextWeekly(weekday: number, hourEt: number, minuteEt: number, from: Date): Date {
  for (let i = 0; i <= 7; i += 1) {
    const etDate = etDateAfter(from, i);
    if (etWeekday(etDate) !== weekday) continue;
    const cand = etWallClockUtc(etDate, hourEt, minuteEt);
    if (cand.getTime() > from.getTime()) return cand;
  }
  // Unreachable (a matching weekday always exists within 8 days) — defensive.
  return etWallClockUtc(etDateAfter(from, 7), hourEt, minuteEt);
}

// --- schedule computation -----------------------------------------------------

/**
 * The first run instant when an automation is ACTIVATED (Confirm), as an ISO
 * string, or null when there is nothing to schedule.
 *  - once     → its `runAt` (may be in the past → the next sweep runs it immediately).
 *  - interval → one interval after activation (Confirm never fires an immediate send;
 *               use "Run now" for that).
 *  - daily/weekly → the next ET occurrence strictly after `from`.
 *  - event    → null (event triggers are not scheduled by `next_run_at`; the worker's
 *               event pass scans upcoming meetings each sweep).
 */
export function firstRunAt(schedule: AutomationSchedule, from: Date): string | null {
  switch (schedule.kind) {
    case 'once':
      return schedule.runAt;
    case 'interval':
      return new Date(from.getTime() + schedule.everyMinutes * 60_000).toISOString();
    case 'daily':
      return nextDaily(schedule.hourEt, schedule.minuteEt ?? 0, from).toISOString();
    case 'weekly':
      return nextWeekly(schedule.weekday, schedule.hourEt, schedule.minuteEt ?? 0, from).toISOString();
    case 'event':
      return null;
  }
}

/**
 * The next run instant AFTER a completed run, as an ISO string, or null when the
 * automation has no further runs (a `once` automation → it is finished/cancelled).
 */
export function nextRunAfter(schedule: AutomationSchedule, from: Date): string | null {
  switch (schedule.kind) {
    case 'once':
      return null;
    case 'interval':
      return new Date(from.getTime() + schedule.everyMinutes * 60_000).toISOString();
    case 'daily':
      return nextDaily(schedule.hourEt, schedule.minuteEt ?? 0, from).toISOString();
    case 'weekly':
      return nextWeekly(schedule.weekday, schedule.hourEt, schedule.minuteEt ?? 0, from).toISOString();
    case 'event':
      return null;
  }
}

// --- parsing / validation (defensive — never trust model or client JSON) -------

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard for a v1 catalog automation type. */
export function isAutomationType(value: unknown): value is AutomationType {
  return typeof value === 'string' && (AUTOMATION_TYPES as readonly string[]).includes(value);
}

/** Parse the untrusted `filters` object of an event schedule (all fields optional). */
function parseEventFilters(value: unknown): EventFilters {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const rec = value as Record<string, unknown>;
  const filters: { meetingsILead?: boolean; clientId?: string } = {};
  const meetingsILead = asBool(rec.meetingsILead);
  const clientId = typeof rec.clientId === 'string' && UUID_RE.test(rec.clientId) ? rec.clientId : undefined;
  if (meetingsILead !== undefined) filters.meetingsILead = meetingsILead;
  if (clientId !== undefined) filters.clientId = clientId;
  return filters;
}

/**
 * Coerce an untrusted value into a valid {@link AutomationSchedule}, or return a
 * reason string. Used by BOTH the agent's create_automation tool and the confirm
 * route's server-side re-validation, so a schedule can never be activated in a
 * shape the worker can't run.
 *
 * `minIntervalMinutes` is the policy floor for a recurring `interval` (P8.1). It
 * defaults to the absolute structural floor ({@link ABSOLUTE_MIN_INTERVAL_MINUTES})
 * so display/re-validation callers never reject an already-stored schedule; the
 * create_automation tool passes the tunable `automations_min_interval_minutes`
 * setting to enforce the higher policy floor (default hourly) at creation.
 */
export function parseSchedule(
  value: unknown,
  minIntervalMinutes: number = ABSOLUTE_MIN_INTERVAL_MINUTES,
): { schedule: AutomationSchedule } | { error: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'schedule must be an object' };
  }
  const rec = value as Record<string, unknown>;
  const kind = rec.kind;

  // The effective floor is never below the structural minimum (guards a mis-set setting).
  const floor = Math.max(minIntervalMinutes, ABSOLUTE_MIN_INTERVAL_MINUTES);

  if (kind === 'once') {
    const runAt = typeof rec.runAt === 'string' ? rec.runAt : '';
    const ts = Date.parse(runAt);
    if (Number.isNaN(ts)) return { error: 'once schedule needs a valid ISO runAt' };
    return { schedule: { kind: 'once', runAt: new Date(ts).toISOString() } };
  }
  if (kind === 'interval') {
    const everyMinutes = asInt(rec.everyMinutes);
    if (everyMinutes === undefined || everyMinutes < floor) {
      return { error: `interval schedule needs everyMinutes ≥ ${floor}` };
    }
    return { schedule: { kind: 'interval', everyMinutes } };
  }
  if (kind === 'event') {
    if (rec.event !== 'before_meeting') {
      return { error: `unknown event: ${String(rec.event)}` };
    }
    const leadMinutes = asInt(rec.leadMinutes);
    if (leadMinutes === undefined || leadMinutes < MIN_EVENT_LEAD_MINUTES || leadMinutes > MAX_EVENT_LEAD_MINUTES) {
      return { error: `before_meeting needs leadMinutes ${MIN_EVENT_LEAD_MINUTES}–${MAX_EVENT_LEAD_MINUTES}` };
    }
    const filters = parseEventFilters(rec.filters);
    const clientName = typeof rec.clientName === 'string' && rec.clientName.trim() !== '' ? rec.clientName.trim() : undefined;
    return {
      schedule: { kind: 'event', event: 'before_meeting', leadMinutes, filters, ...(clientName !== undefined ? { clientName } : {}) },
    };
  }
  if (kind === 'daily') {
    const hourEt = asInt(rec.hourEt);
    const minuteEt = asInt(rec.minuteEt) ?? 0;
    if (hourEt === undefined || hourEt < 0 || hourEt > 23) return { error: 'daily schedule needs hourEt 0–23' };
    if (minuteEt < 0 || minuteEt > 59) return { error: 'daily schedule minuteEt must be 0–59' };
    return { schedule: { kind: 'daily', hourEt, minuteEt } };
  }
  if (kind === 'weekly') {
    const weekday = asInt(rec.weekday);
    const hourEt = asInt(rec.hourEt);
    const minuteEt = asInt(rec.minuteEt) ?? 0;
    if (weekday === undefined || weekday < 0 || weekday > 6) return { error: 'weekly schedule needs weekday 0–6' };
    if (hourEt === undefined || hourEt < 0 || hourEt > 23) return { error: 'weekly schedule needs hourEt 0–23' };
    if (minuteEt < 0 || minuteEt > 59) return { error: 'weekly schedule minuteEt must be 0–59' };
    return { schedule: { kind: 'weekly', weekday, hourEt, minuteEt } };
  }
  return { error: `unknown schedule kind: ${String(kind)}` };
}

/** A short ET wall-clock label like "7:00 AM ET". */
function timeLabel(hourEt: number, minuteEt: number): string {
  const period = hourEt >= 12 ? 'PM' : 'AM';
  const h12 = hourEt % 12 === 0 ? 12 : hourEt % 12;
  return `${h12}:${pad2(minuteEt)} ${period} ET`;
}

/** Compose the "…before each …meeting…" phrase for a `before_meeting` trigger. */
function describeEventTrigger(schedule: EventSchedule): string {
  const lead =
    schedule.leadMinutes % 60 === 0 && schedule.leadMinutes >= 60
      ? `${schedule.leadMinutes / 60} hr`
      : `${schedule.leadMinutes} min`;
  const f = schedule.filters;
  const scope = f.clientId !== undefined ? `${schedule.clientName ?? 'client'} meeting` : 'client meeting';
  const lead2 = f.meetingsILead ? `${scope} you lead` : scope;
  return `${lead} before each ${lead2}`;
}

/** A human-readable one-line description of a schedule (proposal + list rows). */
export function describeSchedule(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case 'once': {
      const label = new Intl.DateTimeFormat('en-US', {
        timeZone: ET,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(schedule.runAt));
      return `Once, on ${label}`;
    }
    case 'interval': {
      const m = schedule.everyMinutes;
      if (m % 1440 === 0) return `Every ${m / 1440} day(s)`;
      if (m % 60 === 0) return `Every ${m / 60} hour(s)`;
      return `Every ${m} minutes`;
    }
    case 'daily':
      return `Every day at ${timeLabel(schedule.hourEt, schedule.minuteEt ?? 0)}`;
    case 'weekly':
      return `Every ${WEEKDAY_LABELS[schedule.weekday]} at ${timeLabel(schedule.hourEt, schedule.minuteEt ?? 0)}`;
    case 'event':
      return describeEventTrigger(schedule);
  }
}

/** True for an event-driven trigger (no `next_run_at`; fires per matching meeting). */
export function isEventSchedule(schedule: AutomationSchedule): schedule is EventSchedule {
  return schedule.kind === 'event';
}
