/**
 * BullMQ job-payload contracts — shared between the enqueuer and the processor.
 * PURE / client-safe (no `bullmq` import). Real pipeline/calendar payloads are
 * added by P4/P5; Phase 1B ships only the sample heartbeat payload.
 */

/**
 * Payload for the sample `heartbeat` job (`QUEUE_NAMES.heartbeat`). Proves the
 * enqueue → process loop end-to-end with no external dependencies.
 */
export interface HeartbeatJobPayload {
  /** Logical origin of the tick — e.g. `'scheduler'` for the repeatable job. */
  readonly source: string;
}
