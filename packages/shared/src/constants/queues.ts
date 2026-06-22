/**
 * Job-queue topology (BullMQ + Redis, D2) — names and schedule constants only.
 *
 * PURE / client-safe: this module must NOT import `bullmq` or any Node-only API.
 * It is the shared contract both sides depend on — `apps/worker` builds the real
 * `Queue`/`Worker` objects from these names, and (P4/P5) `apps/web` API routes
 * import the same names when they enqueue jobs. Extend the maps as later phases
 * add queues (pipeline, ingest, calendar-scan, daily-sync, brief — docs/03 §4).
 */

/** All BullMQ queue names. */
export const QUEUE_NAMES = {
  /** Sample/liveness queue — drives a repeatable heartbeat job. */
  heartbeat: 'heartbeat',
  /** Manual-upload ingest: extract → chunk → embed → pgvector (P5a, docs/06 §5). */
  ingest: 'ingest',
  /** Meeting generation: transcript → 6 docs → tasks → master record → notify (P5b, docs/06 §4). */
  generate: 'generate',
  /** Transcript watchdog: meetings awaiting a transcript past the SLA (P5b, docs/06 §8). */
  watchdog: 'watchdog',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Named jobs within a queue — one entry per (queue, job) the system enqueues. */
export const JOB_NAMES = {
  heartbeat: 'heartbeat.tick',
  ingest: 'ingest.process',
  generate: 'generate.process',
  watchdog: 'watchdog.transcript',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Stable job-scheduler ids for repeatable jobs (BullMQ `upsertJobScheduler`).
 * Keying each logical schedule by a fixed id means re-running the worker UPSERTS
 * the schedule rather than accumulating duplicate repeatables.
 */
export const JOB_SCHEDULER_IDS = {
  heartbeat: 'heartbeat.every-30s',
  transcriptWatchdog: 'watchdog.transcript.every-15m',
} as const;

/** Heartbeat repeat interval (ms) — ~every 30s. A liveness signal, not real work. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Transcript-watchdog sweep interval (ms) — ~every 15 min (docs/06 §8). */
export const TRANSCRIPT_WATCHDOG_INTERVAL_MS = 15 * 60_000;

/**
 * SLA for a transcript to arrive after a bot is dispatched (docs/06 §8). Past
 * this, the watchdog flags the meeting `needs_attention`.
 */
export const TRANSCRIPT_TIMEOUT_MINUTES = 90;
