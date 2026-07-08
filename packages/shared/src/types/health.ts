import type { ClientCadence, RelationshipTrend } from '../constants/enums.js';
import type { ISOTimestamp, UUID } from './common.js';

/**
 * Relationship-health algorithm contracts (P2.1, docs/plan/p2.1-stage-a-plan.md §2).
 *
 * The score is a weighted 0–100 blend of four normalized signals. It is PURELY
 * COMPUTED — never a manually-pinned number — but an admin may override an
 * individual signal's normalized value with a reason (see {@link HealthAdjustment}),
 * and the final score recomputes from the adjusted signals. All weights/thresholds
 * live in the tunable `settings` row `relationship_health_config`.
 */

/** The signals that feed the score. Extend (e.g. `meetingSentiment`) as new inputs land. */
export const HEALTH_SIGNAL_KEYS = [
  'cadenceAdherence',
  'meetingRecency',
  'openOverdueTasks',
  'completionRate',
] as const;
export type HealthSignalKey = (typeof HEALTH_SIGNAL_KEYS)[number];

/**
 * Tunable algorithm configuration (the `relationship_health_config` settings row,
 * a jsonb object). Readers cast the row and fall back to {@link DEFAULT_HEALTH_CONFIG},
 * so the row is optional and the operator can retune without a deploy.
 */
export interface HealthConfig {
  /** Per-signal weights (need not sum to 100 — the calc renormalizes over applicable signals). */
  readonly weights: Readonly<Record<HealthSignalKey, number>>;
  /**
   * Expected days between meetings per cadence. A cadence OMITTED here (e.g. `ad_hoc`)
   * has no cadence expectation, so its adherence signal is dropped for that client.
   */
  readonly cadenceIntervalDays: Partial<Readonly<Record<ClientCadence, number>>>;
  /** Meeting-recency: full score at/under this many days since the last meeting. */
  readonly recencyFullDays: number;
  /** Meeting-recency: zero score at/over this many days since the last meeting. */
  readonly recencyZeroDays: number;
  /** Open/overdue tasks: points subtracted per overdue task. */
  readonly overduePenaltyPerTask: number;
  /** Open/overdue tasks: extra points subtracted per total overdue-day across tasks. */
  readonly overdueAgePenaltyPerDay: number;
  /** Score given to a client with zero completed meetings ever (an un-met client is unhealthy). */
  readonly noMeetingsScore: number;
  /** Trend: compare the current score to the newest snapshot at least this many days old. */
  readonly trendCompareDays: number;
  /** Trend: minimum score delta (points) to read as improving/declining vs stable. */
  readonly trendThreshold: number;
}

/**
 * An admin override of a single signal's normalized 0–100 value, with a required
 * reason (Q2). Stored per-client under `clients.health_adjustments[signalKey]`.
 */
export interface HealthAdjustment {
  readonly value: number;
  readonly reason: string;
  readonly byUserId: UUID | null;
  readonly at: ISOTimestamp;
}

/** Per-signal admin adjustments map (`clients.health_adjustments`). */
export type HealthAdjustments = Partial<Readonly<Record<HealthSignalKey, HealthAdjustment>>>;

/** One signal's contribution to a computed score. */
export interface HealthSignalBreakdown {
  readonly key: HealthSignalKey;
  readonly weight: number;
  /** Raw computed value 0–100, or null when the signal is not applicable (dropped). */
  readonly computed: number | null;
  /** The value actually used: the admin adjustment if set, else `computed`. */
  readonly effective: number | null;
  readonly adjusted: boolean;
  readonly adjustmentReason: string | null;
}

/** Full breakdown of a computed score (persisted in `client_health_history.breakdown`). */
export interface HealthBreakdown {
  readonly score: number;
  readonly signals: readonly HealthSignalBreakdown[];
}

/**
 * Raw inputs the calc needs for one client — gathered by the caller (worker) and
 * passed to {@link computeHealth}. Kept free of DB/Node types so the calc stays pure.
 */
export interface HealthInputs {
  readonly cadence: ClientCadence;
  /** Most recent COMPLETED/transcript-received meeting time, or null if none. */
  readonly lastMeetingAt: ISOTimestamp | null;
  /** Whether the client has ever had a completed meeting (distinguishes "none yet" from "overdue"). */
  readonly hasCompletedMeeting: boolean;
  /** Active (non-archived) tasks: their status + due date. */
  readonly tasks: readonly HealthTaskInput[];
}

export interface HealthTaskInput {
  readonly status: 'open' | 'in_progress' | 'complete';
  readonly dueDate: ISODateOrNull;
}

/** A task due date is an ISO date string or null. */
export type ISODateOrNull = string | null;

/**
 * Client-facing health view (the `GET /api/clients/:id/health` payload). Combines
 * the stored score/trend/freshness with the latest computed breakdown + adjustments,
 * so the base {@link import('./client.js').Client} type stays unchanged.
 */
export interface ClientHealth {
  readonly score: number | null;
  readonly trend: RelationshipTrend | null;
  readonly updatedAt: ISOTimestamp | null;
  readonly breakdown: HealthBreakdown | null;
  readonly adjustments: HealthAdjustments;
}
