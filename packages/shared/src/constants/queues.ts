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
  /** Knowledge Base ingest: extract → chunk → embed → pgvector, global (P6, docs/06 §7). */
  kbIngest: 'kb-ingest',
  /** Meeting generation: transcript → 6 docs → tasks → master record → notify (P5b, docs/06 §4). */
  generate: 'generate',
  /** Transcript watchdog: meetings awaiting a transcript past the SLA (P5b, docs/06 §8). */
  watchdog: 'watchdog',
  /** Calendar scan: Graph calendarView → match client → dedup → upsert meetings (P4, docs/07 §6). */
  calendarScan: 'calendar-scan',
  /** Bot dispatch: dispatch one Recall bot per due, opted-in meeting (P4, docs/07 §1). */
  botDispatch: 'bot-dispatch',
  /** Relationship-health recompute: score signals → clients.relationship_health + trend (P2.1). */
  relationshipHealth: 'relationship-health',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Named jobs within a queue — one entry per (queue, job) the system enqueues. */
export const JOB_NAMES = {
  heartbeat: 'heartbeat.tick',
  ingest: 'ingest.process',
  kbIngest: 'kb-ingest.process',
  generate: 'generate.process',
  watchdog: 'watchdog.transcript',
  calendarScan: 'calendar-scan.sweep',
  botDispatch: 'bot-dispatch.sweep',
  /** Nightly sweep — recompute every active client's health. */
  relationshipHealthSweep: 'relationship-health.sweep',
  /** Single-client recompute enqueued on events (meeting ingest, task/note change). */
  relationshipHealthClient: 'relationship-health.client',
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
  calendarScan: 'calendar-scan.every-30m',
  botDispatch: 'bot-dispatch.every-60s',
  relationshipHealth: 'relationship-health.nightly',
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

/**
 * Calendar-scan sweep interval (ms) — ~every 30 min (P4, docs/09 Phase 4). The
 * repeatable fires around the clock but the processor only does work during
 * business hours ET (see the worker's calendar-scan config).
 */
export const CALENDAR_SCAN_INTERVAL_MS = 30 * 60_000;

/**
 * Bot-dispatch sweep interval (ms) — ~every 60s (P4, docs/07 §1). A tight cadence
 * so a bot can be dispatched within the ≤5-min-before-start window.
 */
export const BOT_DISPATCH_INTERVAL_MS = 60_000;

/**
 * Relationship-health nightly recompute interval (ms) — ~every 24h (P2.1). Between
 * sweeps the score is also refreshed per-client on events (meeting ingested, tasks
 * or notes changed), so the nightly run is the backstop, not the only trigger.
 */
export const RELATIONSHIP_HEALTH_INTERVAL_MS = 24 * 60 * 60_000;
