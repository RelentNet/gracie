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

/**
 * Payload for an `ingest` job (`QUEUE_NAMES.ingest`, P5a). The web `/api/upload`
 * route enqueues one per uploaded file after storing the object + inserting the
 * `documents` row; the worker processor fetches the bytes, extracts text, chunks,
 * embeds (pinned 1536-dim), and writes `embeddings` rows (docs/06 §5).
 */
export interface IngestJobPayload {
  /** `documents.id` of the row this ingest produces embeddings for. */
  readonly documentId: string;
  /** Owning client (`embeddings.client_id`) — scopes vector retrieval. */
  readonly clientId: string;
  /** Storage object key in MinIO (the `documents.r2_key`). */
  readonly objectKey: string;
  /** Original file name (drives extension-based extraction). */
  readonly fileName: string;
  /** MIME type as reported by the upload, when known. */
  readonly mimeType: string | null;
}
