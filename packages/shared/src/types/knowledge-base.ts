/**
 * Knowledge Base view types (M9, docs/08 §8). Client-safe presentation shape for
 * a `knowledge_base_documents` row, shared by the server data layer (which maps
 * the DB row to it) and the UI (which renders it). No `r2_key` — downloads use a
 * presigned URL, never a raw storage key (docs/01 §2).
 */

/** Derived lifecycle state of a KB document — drives the status badge + filter. */
export type KbStatus = 'active' | 'archived' | 'expired';

export interface KnowledgeBaseDocumentView {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly topicTags: readonly string[];
  readonly fileName: string;
  readonly fileSize: number | null;
  /** Short upper-case type label derived from the file extension (PDF, DOCX…). */
  readonly fileType: string;
  /** ISO timestamp the document was uploaded (`created_at`). */
  readonly uploadedAt: string;
  /** `YYYY-MM-DD` expiry, or null when the document does not expire. */
  readonly expirationDate: string | null;
  /** Whether the document is included in AI retrieval (false = archived). */
  readonly aiActive: boolean;
  readonly status: KbStatus;
}
