/**
 * Producer-side BullMQ access for API routes (P5a). Server-only — the web app
 * enqueues jobs the `apps/worker` service consumes. Keeps `@gracie/shared`
 * client-safe (queue NAMES live there; the `Queue`/ioredis objects live here).
 *
 * Lazily builds a single shared ioredis connection + ingest `Queue` per server
 * process. Job options mirror the worker's `DEFAULT_JOB_OPTIONS` (retry with
 * exponential backoff, bounded retention) so producer and consumer agree.
 */
import 'server-only';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  JOB_NAMES,
  QUEUE_NAMES,
  type AutomationJobPayload,
  type CalendarScanJobPayload,
  type DailySyncJobPayload,
  type GenerationJobPayload,
  type IngestJobPayload,
  type KbIngestJobPayload,
  type RelationshipHealthJobPayload,
} from '@gracie/shared';

/** Mirrors apps/worker queues/factory.ts DEFAULT_JOB_OPTIONS. */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

let connection: Redis | undefined;
let ingestQueue: Queue<IngestJobPayload> | undefined;
let kbIngestQueue: Queue<KbIngestJobPayload> | undefined;
let generateQueue: Queue<GenerationJobPayload> | undefined;
let calendarScanQueue: Queue<CalendarScanJobPayload> | undefined;
let relationshipHealthQueue: Queue<RelationshipHealthJobPayload> | undefined;
let dailySyncQueue: Queue<DailySyncJobPayload> | undefined;
let automationsQueue: Queue<AutomationJobPayload> | undefined;

function getConnection(): Redis {
  if (connection !== undefined) return connection;
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') {
    throw new Error('REDIS_URL is not set — required to enqueue ingest jobs.');
  }
  // maxRetriesPerRequest: null is required by BullMQ's blocking commands.
  connection = new Redis(url, { maxRetriesPerRequest: null });
  return connection;
}

function getIngestQueue(): Queue<IngestJobPayload> {
  if (ingestQueue !== undefined) return ingestQueue;
  ingestQueue = new Queue<IngestJobPayload>(QUEUE_NAMES.ingest, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return ingestQueue;
}

/** Enqueue one manual-upload ingest job; returns the BullMQ job id. */
export async function enqueueIngest(payload: IngestJobPayload): Promise<string> {
  const job = await getIngestQueue().add(JOB_NAMES.ingest, payload);
  return job.id ?? '';
}

function getKbIngestQueue(): Queue<KbIngestJobPayload> {
  if (kbIngestQueue !== undefined) return kbIngestQueue;
  kbIngestQueue = new Queue<KbIngestJobPayload>(QUEUE_NAMES.kbIngest, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return kbIngestQueue;
}

/** Enqueue one Knowledge Base ingest job (KB upload → embed); returns the job id. */
export async function enqueueKbIngest(payload: KbIngestJobPayload): Promise<string> {
  const job = await getKbIngestQueue().add(JOB_NAMES.kbIngest, payload);
  return job.id ?? '';
}

function getGenerateQueue(): Queue<GenerationJobPayload> {
  if (generateQueue !== undefined) return generateQueue;
  generateQueue = new Queue<GenerationJobPayload>(QUEUE_NAMES.generate, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return generateQueue;
}

/** Enqueue one meeting-generation job (Recall webhook → pipeline); returns the job id. */
export async function enqueueGenerate(payload: GenerationJobPayload): Promise<string> {
  const job = await getGenerateQueue().add(JOB_NAMES.generate, payload);
  return job.id ?? '';
}

function getCalendarScanQueue(): Queue<CalendarScanJobPayload> {
  if (calendarScanQueue !== undefined) return calendarScanQueue;
  calendarScanQueue = new Queue<CalendarScanJobPayload>(QUEUE_NAMES.calendarScan, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return calendarScanQueue;
}

/**
 * Enqueue a one-off calendar-scan sweep ("Sync now"). A `source: 'manual'` sweep
 * runs immediately regardless of the business-hours gate (the worker consumes the
 * SAME repeatable schedule otherwise). Returns the BullMQ job id.
 */
export async function enqueueCalendarScan(payload: CalendarScanJobPayload): Promise<string> {
  const job = await getCalendarScanQueue().add(JOB_NAMES.calendarScan, payload);
  return job.id ?? '';
}

function getRelationshipHealthQueue(): Queue<RelationshipHealthJobPayload> {
  if (relationshipHealthQueue !== undefined) return relationshipHealthQueue;
  relationshipHealthQueue = new Queue<RelationshipHealthJobPayload>(QUEUE_NAMES.relationshipHealth, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return relationshipHealthQueue;
}

/**
 * Enqueue a single-client relationship-health recompute after a client edit, task,
 * or note change (P2.1). Deduped by a `health:<clientId>` job id so a burst of edits
 * collapses to one recompute. Best-effort: callers wrap this so a missing/unreachable
 * Redis never fails the user's write — the nightly sweep is the backstop.
 */
export async function enqueueRelationshipHealth(clientId: string, source: string): Promise<string> {
  const job = await getRelationshipHealthQueue().add(
    JOB_NAMES.relationshipHealthClient,
    { source, clientId },
    { jobId: `health:${clientId}` },
  );
  return job.id ?? '';
}

/**
 * Enqueue a FULL relationship-health sweep (every active client) — used by the
 * Scoring settings editor so retuned weights/thresholds take effect immediately
 * instead of waiting for the nightly run (P9). The `clientId`-less payload routes
 * the worker to its sweep path. No static jobId: each save recomputes with the
 * just-saved config (a fixed id retained in `completed` would silently drop the
 * next save's sweep). Best-effort — the caller wraps it so a Redis blip never
 * fails the save; the nightly sweep is the backstop.
 */
export async function enqueueRelationshipHealthSweep(source: string): Promise<string> {
  const job = await getRelationshipHealthQueue().add(JOB_NAMES.relationshipHealthSweep, { source });
  return job.id ?? '';
}

function getDailySyncQueue(): Queue<DailySyncJobPayload> {
  if (dailySyncQueue !== undefined) return dailySyncQueue;
  dailySyncQueue = new Queue<DailySyncJobPayload>(QUEUE_NAMES.dailySync, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return dailySyncQueue;
}

/**
 * Enqueue a one-off daily-sync run ("Generate now", P7). A `source: 'manual'` run
 * bypasses the 6 AM ET send-hour gate and runs immediately (the worker consumes the
 * SAME repeatable schedule otherwise). Returns the BullMQ job id.
 */
export async function enqueueDailySync(payload: DailySyncJobPayload): Promise<string> {
  const job = await getDailySyncQueue().add(JOB_NAMES.dailySync, payload);
  return job.id ?? '';
}

function getAutomationsQueue(): Queue<AutomationJobPayload> {
  if (automationsQueue !== undefined) return automationsQueue;
  automationsQueue = new Queue<AutomationJobPayload>(QUEUE_NAMES.automations, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return automationsQueue;
}

/**
 * Enqueue an immediate single-automation run (P8) — the GUI "Run now" and an
 * immediate `once` confirm. `source: 'manual'` + the `automationId` route the
 * worker to run exactly this one automation regardless of its schedule. Returns the
 * BullMQ job id.
 */
export async function enqueueAutomationRun(automationId: string): Promise<string> {
  const job = await getAutomationsQueue().add(JOB_NAMES.automationsRun, {
    source: 'manual',
    automationId,
  });
  return job.id ?? '';
}
