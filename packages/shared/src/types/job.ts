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

/**
 * Payload for a relationship-health recompute job (`QUEUE_NAMES.relationshipHealth`,
 * P2.1). Two shapes share the queue: the nightly repeatable sweep recomputes every
 * active client (`clientId` omitted), and event-triggered jobs recompute one client
 * (`clientId` set) after a meeting is ingested or its tasks/notes/cadence change. The
 * job also refreshes that client's `last_meeting_at`. Per-client jobs are deduped by
 * a `health:<clientId>` BullMQ job id so event bursts collapse to one recompute.
 */
export interface RelationshipHealthJobPayload {
  /** Logical origin — e.g. `'scheduler'`, `'calendar-scan'`, `'task'`, `'note'`, `'client-edit'`. */
  readonly source: string;
  /** A single client to recompute; omit for the nightly all-clients sweep. */
  readonly clientId?: string;
}

/**
 * Payload for the repeatable daily-sync job (`QUEUE_NAMES.dailySync`, P7). The
 * gated sweep gathers the morning digest + that day's pre-meeting briefs and emails
 * all active staff (allowlist-gated). No per-run data — the processor reads
 * everything from the DB and is idempotent per `sync_date`.
 */
export interface DailySyncJobPayload {
  /**
   * Logical origin — `'scheduler'` for the repeatable sweep (honours the ET send-hour
   * gate + `daily_sync_enabled`), or `'manual'` for an Admin "Generate now" / test run,
   * which bypasses the gate and runs immediately.
   */
  readonly source: string;
}

/**
 * Payload for the repeatable contact-suggestions sweep (`QUEUE_NAMES.contactSuggestions`,
 * phase `CO`). No per-item data — each sweep scans `meetings.external_attendees`, skips
 * emails already a contact / already a pending-or-dismissed suggestion / free-email, and
 * upserts pending `contact_suggestions` rows (guessing the org by domain). Idempotent.
 */
export interface ContactSuggestionsJobPayload {
  /** Logical origin — e.g. `'scheduler'` for the repeatable sweep, `'calendar-scan'`. */
  readonly source: string;
}

/**
 * Payload for the automations engine (`QUEUE_NAMES.automations`, P8). Two shapes
 * share the queue, mirroring relationship-health:
 *  - the repeatable DUE-SWEEP (`automationId` omitted) selects every enabled+active
 *    automation whose `next_run_at <= now`, runs each, writes an `automation_runs`
 *    audit row, and advances `next_run_at`;
 *  - a single RUN-NOW job (`automationId` set, `source: 'manual'`) runs exactly one
 *    automation immediately regardless of its schedule (the GUI "Run now" + a `once`
 *    confirm that should fire straight away).
 */
export interface AutomationJobPayload {
  /** Logical origin — `'scheduler'` for the sweep, `'manual'` for a Run-now/confirm. */
  readonly source: string;
  /** A single automation to run now; omit for the due-sweep. */
  readonly automationId?: string;
}

/**
 * Payload for the documents recycle-bin purge sweep
 * (`QUEUE_NAMES.documentsPurge`). No per-item data — each run selects every
 * soft-deleted document/folder past the retention window and destroys it.
 *
 * Gated by the `documents_trash_purge_enabled` setting: when off (the shipped
 * default) the sweep still runs and reports what it WOULD purge, but deletes nothing.
 */
export interface DocumentsPurgeJobPayload {
  /** Logical origin — e.g. `'scheduler'` for the repeatable nightly sweep. */
  readonly source: string;
}
