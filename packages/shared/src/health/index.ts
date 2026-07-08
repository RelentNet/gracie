/**
 * Relationship-health algorithm (P2.1, docs/plan/p2.1-stage-a-plan.md §2).
 *
 * PURE + client-safe — no DB, clock, or Node APIs. The caller (the worker's
 * recompute job) gathers {@link HealthInputs} and passes an explicit `now`, so the
 * scoring stays deterministic and unit-testable. The score is a weighted blend of
 * four normalized 0–100 signals; a signal with no data is DROPPED and the remaining
 * weights renormalize. An admin may override any single signal's value (with a
 * reason) — that override wins over the computed value, so the final score stays
 * computed while still reflecting the admin's knowledge.
 */
import type { ClientCadence, RelationshipTrend } from '../constants/enums.js';
import { HEALTH_SIGNAL_KEYS } from '../types/health.js';
import type {
  HealthAdjustment,
  HealthAdjustments,
  HealthBreakdown,
  HealthConfig,
  HealthInputs,
  HealthSignalBreakdown,
  HealthSignalKey,
  HealthTaskInput,
} from '../types/health.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default config — mirrors the `relationship_health_config` seed in migration 0007. */
export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  weights: {
    cadenceAdherence: 45,
    meetingRecency: 20,
    openOverdueTasks: 20,
    completionRate: 15,
  },
  cadenceIntervalDays: {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    qbr: 90,
    // `ad_hoc` intentionally omitted — no cadence expectation → adherence signal dropped.
  },
  recencyFullDays: 30,
  recencyZeroDays: 90,
  overduePenaltyPerTask: 15,
  overdueAgePenaltyPerDay: 1,
  noMeetingsScore: 0,
  trendCompareDays: 14,
  trendThreshold: 5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Whole days between an earlier ISO timestamp and `now` (>= 0). */
function daysSince(iso: string, now: Date): number {
  const diff = now.getTime() - new Date(iso).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / MS_PER_DAY);
}

/** Whole days a `YYYY-MM-DD` due date is overdue relative to `now` (>= 0). */
function daysOverdue(dueDate: string, now: Date): number {
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = today - due;
  return diff <= 0 ? 0 : Math.floor(diff / MS_PER_DAY);
}

/** Cadence-adherence 0–100: latest meeting within the cadence window scores 100, decaying to 0 at 2× the window. */
function cadenceAdherenceSignal(inputs: HealthInputs, config: HealthConfig, now: Date): number | null {
  const interval = config.cadenceIntervalDays[inputs.cadence];
  if (interval === undefined || interval <= 0) return null; // no cadence expectation (e.g. ad_hoc)
  if (!inputs.hasCompletedMeeting || inputs.lastMeetingAt === null) return config.noMeetingsScore;
  const ratio = daysSince(inputs.lastMeetingAt, now) / interval;
  if (ratio <= 1) return 100;
  if (ratio >= 2) return 0;
  return clamp(100 * (2 - ratio), 0, 100);
}

/** Meeting-recency 0–100: absolute days since the last completed meeting, full → zero across a window. */
function meetingRecencySignal(inputs: HealthInputs, config: HealthConfig, now: Date): number | null {
  if (!inputs.hasCompletedMeeting || inputs.lastMeetingAt === null) return config.noMeetingsScore;
  const days = daysSince(inputs.lastMeetingAt, now);
  if (days <= config.recencyFullDays) return 100;
  if (days >= config.recencyZeroDays) return 0;
  const span = config.recencyZeroDays - config.recencyFullDays;
  return span <= 0 ? 0 : clamp((100 * (config.recencyZeroDays - days)) / span, 0, 100);
}

/** Open/overdue-tasks 0–100: full when nothing is overdue, penalized by count + age of overdue tasks. */
function openOverdueTasksSignal(tasks: readonly HealthTaskInput[], config: HealthConfig, now: Date): number | null {
  if (tasks.length === 0) return null; // no tasks → signal dropped (not a penalty)
  const overdue = tasks.filter(
    (t) => t.status !== 'complete' && t.dueDate !== null && daysOverdue(t.dueDate, now) > 0,
  );
  const ageDays = overdue.reduce((sum, t) => sum + daysOverdue(t.dueDate as string, now), 0);
  const penalty = overdue.length * config.overduePenaltyPerTask + ageDays * config.overdueAgePenaltyPerDay;
  return clamp(100 - penalty, 0, 100);
}

/** Task-completion-rate 0–100: share of the client's active tasks that are complete. */
function completionRateSignal(tasks: readonly HealthTaskInput[]): number | null {
  if (tasks.length === 0) return null; // no tasks → signal dropped
  const complete = tasks.filter((t) => t.status === 'complete').length;
  return Math.round((complete / tasks.length) * 100);
}

/**
 * Compute a client's relationship-health breakdown. Signals with a computed value
 * of `null` are dropped unless an admin adjustment supplies one; the score is the
 * weight-normalized blend of the applicable signals' effective values, clamped 0–100.
 */
export function computeHealth(
  inputs: HealthInputs,
  config: HealthConfig,
  adjustments: HealthAdjustments,
  now: Date,
): HealthBreakdown {
  const computedByKey: Readonly<Record<HealthSignalKey, number | null>> = {
    cadenceAdherence: cadenceAdherenceSignal(inputs, config, now),
    meetingRecency: meetingRecencySignal(inputs, config, now),
    openOverdueTasks: openOverdueTasksSignal(inputs.tasks, config, now),
    completionRate: completionRateSignal(inputs.tasks),
  };

  const signals: HealthSignalBreakdown[] = HEALTH_SIGNAL_KEYS.map((key) => {
    const computed = computedByKey[key];
    const adjustment = adjustments[key];
    const effective = adjustment !== undefined ? clamp(adjustment.value, 0, 100) : computed;
    return {
      key,
      weight: config.weights[key] ?? 0,
      computed,
      effective,
      adjusted: adjustment !== undefined,
      adjustmentReason: adjustment?.reason ?? null,
    };
  });

  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of signals) {
    if (s.effective === null || s.weight <= 0) continue;
    weightedSum += s.weight * s.effective;
    weightTotal += s.weight;
  }
  const score = weightTotal === 0 ? config.noMeetingsScore : Math.round(weightedSum / weightTotal);
  return { score: clamp(score, 0, 100), signals };
}

/**
 * Derive the trend from the current score and the score at a prior snapshot. A delta
 * of at least `trendThreshold` reads as improving/declining; otherwise stable. No
 * prior snapshot → stable (not enough history to call a direction yet).
 */
export function deriveTrend(
  currentScore: number,
  priorScore: number | null,
  config: HealthConfig,
): RelationshipTrend {
  if (priorScore === null) return 'stable';
  const delta = currentScore - priorScore;
  if (delta >= config.trendThreshold) return 'improving';
  if (delta <= -config.trendThreshold) return 'declining';
  return 'stable';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Defensively parse the stored `clients.health_adjustments` jsonb into a typed map.
 * Ignores unknown keys and malformed entries (no `value` number), so a hand-edited
 * or partial column never crashes the recompute or the API.
 */
export function parseHealthAdjustments(raw: unknown): HealthAdjustments {
  if (raw === null || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const out: Partial<Record<HealthSignalKey, HealthAdjustment>> = {};
  for (const key of HEALTH_SIGNAL_KEYS) {
    const entry = record[key];
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (!isFiniteNumber(obj.value)) continue;
    out[key] = {
      value: clamp(obj.value, 0, 100),
      reason: typeof obj.reason === 'string' ? obj.reason : '',
      byUserId: typeof obj.byUserId === 'string' ? obj.byUserId : null,
      at: typeof obj.at === 'string' ? obj.at : new Date(0).toISOString(),
    };
  }
  return out;
}

/**
 * Parse the raw `relationship_health_config` settings value into a full config,
 * defensively merging over {@link DEFAULT_HEALTH_CONFIG} so a missing, partial, or
 * malformed row still yields a complete, usable config.
 */
export function parseHealthConfig(raw: unknown): HealthConfig {
  if (raw === null || typeof raw !== 'object') return DEFAULT_HEALTH_CONFIG;
  const r = raw as Record<string, unknown>;

  const weights = { ...DEFAULT_HEALTH_CONFIG.weights };
  if (r.weights !== null && typeof r.weights === 'object') {
    const rw = r.weights as Record<string, unknown>;
    for (const key of HEALTH_SIGNAL_KEYS) {
      if (isFiniteNumber(rw[key])) weights[key] = rw[key];
    }
  }

  const cadenceIntervalDays: Partial<Record<ClientCadence, number>> = {
    ...DEFAULT_HEALTH_CONFIG.cadenceIntervalDays,
  };
  if (r.cadenceIntervalDays !== null && typeof r.cadenceIntervalDays === 'object') {
    const rc = r.cadenceIntervalDays as Record<string, unknown>;
    for (const cadence of ['weekly', 'biweekly', 'monthly', 'qbr', 'ad_hoc'] as const) {
      if (isFiniteNumber(rc[cadence])) cadenceIntervalDays[cadence] = rc[cadence];
    }
  }

  const num = (key: keyof HealthConfig): number => {
    const v = r[key];
    return isFiniteNumber(v) ? v : (DEFAULT_HEALTH_CONFIG[key] as number);
  };

  return {
    weights,
    cadenceIntervalDays,
    recencyFullDays: num('recencyFullDays'),
    recencyZeroDays: num('recencyZeroDays'),
    overduePenaltyPerTask: num('overduePenaltyPerTask'),
    overdueAgePenaltyPerDay: num('overdueAgePenaltyPerDay'),
    noMeetingsScore: num('noMeetingsScore'),
    trendCompareDays: num('trendCompareDays'),
    trendThreshold: num('trendThreshold'),
  };
}
