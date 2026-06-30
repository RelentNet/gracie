/**
 * Server-side data access for the Knowledge Base (M9, P6).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement is
 * the API layer's job (docs/02 §D14). Server-only — never import into a client
 * component. KB documents are firm-wide reference material: their embeddings are
 * global (`embeddings.client_id = null`) and retrievable into any client's chat
 * when `ai_active = true` (see `match_kb_embeddings`). Mirrors lib/data/uploads.ts
 * + lib/data/clients.ts.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import type { KbStatus, KnowledgeBaseDocumentView } from '@gracie/shared';

type KbRow = Database['public']['Tables']['knowledge_base_documents']['Row'];

export interface KbListFilters {
  readonly search?: string;
  readonly tags?: readonly string[];
  readonly status?: KbStatus;
}

/** Today's date as `YYYY-MM-DD` (UTC), for comparing against `expiration_date`. */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lower-cased file extension without the dot ('' if none). */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** Short display type from the file extension. */
function deriveFileType(fileName: string): string {
  const ext = extensionOf(fileName);
  return ext === '' ? 'FILE' : ext.toUpperCase();
}

/** Derive lifecycle status: archived (not AI-active) → expired → active. */
function deriveStatus(row: Pick<KbRow, 'ai_active' | 'expiration_date'>, today: string): KbStatus {
  if (!row.ai_active) return 'archived';
  if (row.expiration_date !== null && row.expiration_date < today) return 'expired';
  return 'active';
}

function mapKbDocument(row: KbRow, today: string): KnowledgeBaseDocumentView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    topicTags: row.topic_tags,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileType: deriveFileType(row.file_name),
    uploadedAt: row.created_at,
    expirationDate: row.expiration_date,
    aiActive: row.ai_active,
    status: deriveStatus(row, today),
  };
}

/** A loosely-formatted v4-ish UUID — used to avoid passing a mock id to a FK column. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Object key under `knowledge-base/[YYYY-MM-DD]/<ms>-<file>`. A millisecond prefix
 * keeps re-uploads of the same name unique. KB lives outside any client folder
 * (firm-wide), so the key carries no client slug.
 */
export function buildKbKey(fileName: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  return `knowledge-base/${date}/${now.getTime()}-${safe}`;
}

/**
 * List KB documents, newest first, with optional in-memory filtering by free-text
 * search (title/description), topic tags (any overlap), and derived status. The KB
 * is a small firm-wide set, so a single ordered fetch + JS filter is sufficient
 * and avoids brittle `ilike`-pattern escaping.
 */
export async function listKnowledgeBaseDocuments(
  filters: KbListFilters = {},
): Promise<KnowledgeBaseDocumentView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('knowledge_base_documents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(`listKnowledgeBaseDocuments: ${error.message}`);

  const today = todayDate();
  let docs = (data ?? []).map((row) => mapKbDocument(row, today));

  const search = filters.search?.trim().toLowerCase();
  if (search !== undefined && search !== '') {
    docs = docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(search) ||
        (doc.description ?? '').toLowerCase().includes(search),
    );
  }

  if (filters.tags !== undefined && filters.tags.length > 0) {
    const wanted = new Set(filters.tags.map((tag) => tag.toLowerCase()));
    docs = docs.filter((doc) => doc.topicTags.some((tag) => wanted.has(tag.toLowerCase())));
  }

  if (filters.status !== undefined) {
    docs = docs.filter((doc) => doc.status === filters.status);
  }

  return docs;
}

/** Fetch one KB document view by id, or null if not found. */
export async function getKnowledgeBaseDocument(id: string): Promise<KnowledgeBaseDocumentView | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('knowledge_base_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error !== null) throw new Error(`getKnowledgeBaseDocument: ${error.message}`);
  return data === null ? null : mapKbDocument(data, todayDate());
}

export interface NewKbDocumentInput {
  readonly title: string;
  readonly description: string | null;
  readonly topicTags: readonly string[];
  readonly r2Key: string;
  readonly fileName: string;
  readonly fileSize: number | null;
  readonly expirationDate: string | null;
  readonly aiActive: boolean;
  readonly uploadedByUserId: string | null;
}

/** Insert a KB document row; returns the created view. */
export async function insertKnowledgeBaseDocument(
  input: NewKbDocumentInput,
): Promise<KnowledgeBaseDocumentView> {
  const db = getServerClient();
  const insert: Database['public']['Tables']['knowledge_base_documents']['Insert'] = {
    title: input.title,
    description: input.description,
    topic_tags: [...input.topicTags],
    r2_key: input.r2Key,
    file_name: input.fileName,
    file_size: input.fileSize,
    expiration_date: input.expirationDate,
    ai_active: input.aiActive,
    // FK to users(id) (uuid); a non-uuid mock id would break the insert, so guard.
    uploaded_by_user_id:
      input.uploadedByUserId !== null && UUID_RE.test(input.uploadedByUserId)
        ? input.uploadedByUserId
        : null,
  };
  const { data, error } = await db
    .from('knowledge_base_documents')
    .insert(insert)
    .select('*')
    .single();
  if (error !== null) throw new Error(`insertKnowledgeBaseDocument: ${error.message}`);
  return mapKbDocument(data, todayDate());
}

export interface KbDocumentPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly topicTags?: readonly string[];
  readonly expirationDate?: string | null;
  /** Toggle AI retrieval — false archives the doc (stops it being retrieved). */
  readonly aiActive?: boolean;
}

/** Update KB metadata / archive flag; returns the updated view, or null if absent. */
export async function updateKnowledgeBaseDocument(
  id: string,
  patch: KbDocumentPatch,
): Promise<KnowledgeBaseDocumentView | null> {
  const update: Database['public']['Tables']['knowledge_base_documents']['Update'] = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.topicTags !== undefined) update.topic_tags = [...patch.topicTags];
  if (patch.expirationDate !== undefined) update.expiration_date = patch.expirationDate;
  if (patch.aiActive !== undefined) update.ai_active = patch.aiActive;

  const db = getServerClient();
  const { data, error } = await db
    .from('knowledge_base_documents')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateKnowledgeBaseDocument: ${error.message}`);
  return data === null ? null : mapKbDocument(data, todayDate());
}

/**
 * Delete a KB document and its embeddings; returns the deleted object's storage
 * key (so the caller can remove the object), or null if the document was absent.
 */
export async function deleteKnowledgeBaseDocument(id: string): Promise<{ r2Key: string } | null> {
  const db = getServerClient();
  const existing = await db
    .from('knowledge_base_documents')
    .select('r2_key')
    .eq('id', id)
    .maybeSingle();
  if (existing.error !== null) throw new Error(`deleteKnowledgeBaseDocument: ${existing.error.message}`);
  if (existing.data === null) return null;

  const clearedEmbeddings = await db
    .from('embeddings')
    .delete()
    .eq('source_type', 'knowledge_base')
    .eq('source_id', id);
  if (clearedEmbeddings.error !== null) {
    throw new Error(`deleteKnowledgeBaseDocument embeddings: ${clearedEmbeddings.error.message}`);
  }

  const deleted = await db.from('knowledge_base_documents').delete().eq('id', id);
  if (deleted.error !== null) throw new Error(`deleteKnowledgeBaseDocument: ${deleted.error.message}`);
  return { r2Key: existing.data.r2_key };
}
