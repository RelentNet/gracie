/**
 * Application enums — mirrors the Postgres enums in
 * docs/04-database-schema.sql. Kept as `as const` string-literal tuples so the
 * same values serve as both runtime constants and derived union types.
 */

// --- clients ---------------------------------------------------------------
export const CLIENT_CADENCES = ['weekly', 'biweekly', 'monthly', 'qbr', 'ad_hoc'] as const;
export type ClientCadence = (typeof CLIENT_CADENCES)[number];

/**
 * Party type on `clients` (P4.1). One domain-keyed table holds every party;
 * `type` distinguishes real clients from the funnel + the internal workspace.
 * "Promote a lead → client" is just flipping this value. Only `client` rows
 * appear on client-only surfaces (roster, cadence, ambiguous-assign picker);
 * `internal` is the single Grace & Associates workspace org.
 */
export const CLIENT_TYPES = ['client', 'prospect', 'lead', 'partner', 'internal'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const FEE_TIERS = ['low', 'mid', 'high'] as const; // admin-only data
export type FeeTier = (typeof FEE_TIERS)[number];

export const RELATIONSHIP_TRENDS = ['improving', 'stable', 'declining'] as const;
export type RelationshipTrend = (typeof RELATIONSHIP_TRENDS)[number];

// --- meetings --------------------------------------------------------------
export const MEETING_TYPES = [
  'weekly_sync',
  'biweekly_cadence',
  'monthly_review',
  'qbr',
  'technical_review',
  'kickoff',
  'ad_hoc',
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_SOURCES = ['calendar', 'manual'] as const;
export type MeetingSource = (typeof MEETING_SOURCES)[number];

export const PIPELINE_STATUSES = [
  'scheduled',
  'in_progress',
  'awaiting_transcript',
  'processing',
  'complete',
  'needs_attention',
  'cancelled',
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

// --- documents -------------------------------------------------------------
export const DOCUMENT_TYPES = [
  'post_meeting_analysis',
  'internal_memo',
  'client_summary',
  'task_checklist',
  'internal_email_draft',
  'client_email_draft',
  'pre_meeting_brief',
  'daily_sync',
  'upload',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_SOURCES = ['meeting', 'upload', 'auto'] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const DOCUMENT_STATUSES = ['ready', 'needs_review', 'delivered', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// --- tasks -----------------------------------------------------------------
export const TASK_STATUSES = ['open', 'in_progress', 'complete'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// --- folders ---------------------------------------------------------------
export const FOLDER_VISIBILITIES = ['all', 'restricted'] as const;
export type FolderVisibility = (typeof FOLDER_VISIBILITIES)[number];

// --- pipeline runs ---------------------------------------------------------
export const PIPELINE_RUN_SOURCES = ['recall', 'manual_upload'] as const;
export type PipelineRunSource = (typeof PIPELINE_RUN_SOURCES)[number];

export const PIPELINE_RUN_STATUSES = ['success', 'failed', 'partial'] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

// --- embeddings ------------------------------------------------------------
export const EMBEDDING_SOURCES = [
  'meeting_document',
  'upload',
  'knowledge_base',
  'transcript',
] as const;
export type EmbeddingSource = (typeof EMBEDDING_SOURCES)[number];

// --- notifications ---------------------------------------------------------
export const NOTIFICATION_TYPES = [
  'documents_ready',
  'needs_attention',
  'task_assigned',
  'kb_expiring',
  'calendar_disconnect',
  'pipeline_failed',
  // P8: reminder-action deliveries + advanced-request admin alerts (Bell).
  'automation',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// --- automations (P8) ------------------------------------------------------
/**
 * The v1 action catalog (docs/plan p8 §8). `create_automation`'s JSON-Schema only
 * accepts these values, so the agent literally cannot request an unbuilt action;
 * out-of-catalog asks go to the advanced-requests inbox instead. Extending the
 * engine = a new value here + a new executor in the worker.
 *   - client_report    — a per-client summary (health, recent activity, open items).
 *   - portfolio_digest — a cross-client rollup (cadence + at-risk clients).
 *   - activity_digest  — a yesterday/today activity rollup (reuses daily-sync gather).
 *   - reminder         — a scheduled nudge/notification to internal users.
 *   - meeting_brief    — an EVENT-triggered pre-meeting brief for a specific upcoming
 *                        meeting (P8.1). Not schedule-based: a `before_meeting` event
 *                        schedule fires it a set lead time before each matching meeting.
 *                        Delivered INTERNALLY (owner + the meeting's internal attendees).
 *   - client_send      — deliver a report/message to an EXTERNAL client (the gated,
 *                        admin-enabled, explicitly-confirmed customer-contact exception).
 */
export const AUTOMATION_TYPES = [
  'client_report',
  'portfolio_digest',
  'activity_digest',
  'reminder',
  'meeting_brief',
  'client_send',
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

/** Lifecycle of an automation. Starts `pending_confirmation` (proposed, not running). */
export const AUTOMATION_STATUSES = ['pending_confirmation', 'active', 'paused', 'cancelled'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

/** Outcome recorded on each `automation_runs` audit row. */
export const AUTOMATION_RUN_STATUSES = ['success', 'failed', 'skipped'] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/** Lifecycle of an advanced (out-of-catalog) request in the admin inbox. */
export const AUTOMATION_REQUEST_STATUSES = ['pending', 'accepted', 'dismissed'] as const;
export type AutomationRequestStatus = (typeof AUTOMATION_REQUEST_STATUSES)[number];

/** Which client_send-style automations may email externally (the customer exception). */
export const AUTOMATION_TYPES_WITH_EXTERNAL: readonly AutomationType[] = ['client_send'];

// --- integrations ----------------------------------------------------------
export const INTEGRATION_KEYS = [
  'recall',
  'openai',
  'anthropic',
  'resend',
  'r2',
  'ms_graph',
  'logto',
  'supabase',
] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

/**
 * UI-facing status vocabulary used by `StatusBadge` (docs/08 §5). This is the
 * presentation layer's status set, distinct from the DB `pipeline_status`.
 */
export const BADGE_STATUSES = [
  'scheduled',
  'processing',
  'complete',
  'needs-review',
  'overdue',
] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];

/**
 * DocumentPill visual types (docs/08 §5). Maps the broad DB `document_type`
 * set down to the five pill categories the UI renders.
 */
export const DOCUMENT_PILL_TYPES = [
  'analysis',
  'memo',
  'summary',
  'checklist',
  'email',
] as const;
export type DocumentPillType = (typeof DOCUMENT_PILL_TYPES)[number];
