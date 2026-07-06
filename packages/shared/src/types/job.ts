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

/**
 * Payload for a `kb-ingest` job (`QUEUE_NAMES.kbIngest`, P6). The web
 * `/api/knowledge-base` route enqueues one after storing the object + inserting
 * the `knowledge_base_documents` row; the worker fetches the bytes, extracts
 * text, chunks, embeds (pinned 1536-dim), and writes `embeddings` rows with
 * `source_type='knowledge_base'`, `source_id=<kb id>`, `client_id=null` — global
 * reference material retrievable into any client's chat (docs/06 §7). Mirrors
 * `IngestJobPayload` but has no owning client (KB is firm-wide).
 */
export interface KbIngestJobPayload {
  /** `knowledge_base_documents.id` this ingest produces embeddings for. */
  readonly knowledgeBaseDocumentId: string;
  /** Storage object key in MinIO (the `knowledge_base_documents.r2_key`). */
  readonly objectKey: string;
  /** Original file name (drives extension-based extraction). */
  readonly fileName: string;
  /** MIME type as reported by the upload, when known. */
  readonly mimeType: string | null;
}

/**
 * Payload for a `generate` job (`QUEUE_NAMES.generate`, P5b). The Recall webhook
 * (`/api/webhooks/recall`) enqueues one after verifying the meeting + bot_job_id;
 * the worker processor fetches the transcript (or uses `transcriptOverride`),
 * embeds it, and runs the sequential 6-document pipeline (docs/06 §4).
 */
export interface GenerationJobPayload {
  /** `meetings.id` this generation run is for. */
  readonly meetingId: string;
  /** Recall `bot_job_id` to fetch the transcript with (null when overridden). */
  readonly botJobId: string | null;
  /**
   * Direct transcript text — bypasses the Recall fetch. Set by tests/local runs
   * to exercise the full pipeline without a live Recall webhook (docs/06 §4 test
   * path); production webhook jobs omit it and the worker fetches from Recall.
   */
  readonly transcriptOverride?: string;
}

/**
 * Payload for the repeatable transcript-watchdog job (`QUEUE_NAMES.watchdog`,
 * P5b). No per-meeting data — each sweep scans for meetings stuck awaiting a
 * transcript past the SLA (docs/06 §8).
 */
export interface WatchdogJobPayload {
  /** Logical origin of the sweep — e.g. `'scheduler'` for the repeatable job. */
  readonly source: string;
}

/**
 * Payload for the repeatable calendar-scan job (`QUEUE_NAMES.calendarScan`, P4).
 * No per-meeting data — each sweep reads the group members' Outlook calendars via
 * Microsoft Graph, matches events to clients, dedups the same meeting across
 * attendees, and upserts `meetings` (docs/07 §6, docs/09 Phase 4).
 */
export interface CalendarScanJobPayload {
  /** Logical origin of the sweep — e.g. `'scheduler'` for the repeatable job. */
  readonly source: string;
}

/**
 * Payload for the repeatable bot-dispatch job (`QUEUE_NAMES.botDispatch`, P4).
 * No per-meeting data — each sweep selects meetings starting within the lead
 * window that are client-assigned, not yet dispatched, and whose lead has not
 * opted out, then dispatches exactly one Recall bot per meeting (docs/07 §1).
 */
export interface BotDispatchJobPayload {
  /** Logical origin of the sweep — e.g. `'scheduler'` for the repeatable job. */
  readonly source: string;
}
