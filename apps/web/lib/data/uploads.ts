/**
 * Server-side data access for manual uploads (P5a, docs/06 §5).
 *
 * Builds the MinIO object key, and inserts the `documents` row
 * (`source_badge='upload'`). Uses the service-role client (bypasses RLS);
 * permission enforcement is the API layer's job (docs/02 §D14). Server-only.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';

/** URL/path-safe slug from a client name (e.g. "CMS Data Analytics" → "cms-data-analytics"). */
export function clientSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'client' : slug;
}

/**
 * Object key under `clients/[slug]/uploads/[YYYY-MM-DD]/<file>` (docs/06 §5). A
 * millisecond prefix on the file segment keeps re-uploads of the same name on the
 * same day unique (the `documents.r2_key` index is unique) without leaving the
 * date prefix that folder authorization matches on.
 */
export function buildUploadKey(slug: string, fileName: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const safe =
    fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  return `clients/${slug}/uploads/${date}/${now.getTime()}-${safe}`;
}

export interface UploadDocumentInput {
  readonly clientId: string;
  readonly r2Key: string;
  readonly fileName: string;
  readonly fileSize: number;
}

/** Insert the `documents` row for an upload; returns the new document id. */
export async function insertUploadDocument(input: UploadDocumentInput): Promise<string> {
  const db = getServerClient();
  const insert: Database['public']['Tables']['documents']['Insert'] = {
    client_id: input.clientId,
    document_type: 'upload',
    source_badge: 'upload',
    r2_key: input.r2Key,
    file_name: input.fileName,
    file_size: input.fileSize,
    status: 'ready',
  };
  const { data, error } = await db.from('documents').insert(insert).select('id').single();
  if (error !== null) throw new Error(`insertUploadDocument: ${error.message}`);
  return data.id;
}
