/**
 * Server-side data access for manual uploads (P5a, docs/06 §5; drive-feel filing
 * per docs/plan p2fix §2).
 *
 * Builds the MinIO object key, find-or-creates the destination folder for the
 * chosen subtype, and inserts the `documents` row (`source_badge='upload'`) with
 * its `folder_id` set so the file appears inside that folder in the browser. Uses
 * the service-role client (bypasses RLS); permission enforcement is the API
 * layer's job (docs/02 §D14). Server-only.
 */
import 'server-only';

import { findOrCreateFolder, getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import type { DocumentStatus, DocumentType } from '@gracie/shared';

import { resolveSubtype } from '../upload-subtypes.js';

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
 * Object key under `<folderPath>/[YYYY-MM-DD]/<file>` (docs/06 §5). `folderPath`
 * is the destination folder's R2 prefix so the object lives UNDER the folder that
 * governs its authorization (`canAccessKey` matches on folder-path prefixes). A
 * millisecond prefix on the file segment keeps re-uploads of the same name on the
 * same day unique (the `documents.r2_key` index is unique).
 */
export function buildUploadKey(folderPath: string, fileName: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const safe =
    fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  return `${folderPath}/${date}/${now.getTime()}-${safe}`;
}

/**
 * Find-or-create the destination folder for an upload subtype and return both its
 * id (for `documents.folder_id`) and path (to build the object key). Subtype
 * folders nest under the client's `Uploads` folder, which is ensured first so the
 * tree renders them as children; `Transcript` files into the Admin-only folder.
 */
export async function ensureUploadFolder(
  clientId: string,
  slug: string,
  subtypeValue: string,
): Promise<{ folderId: string; folderPath: string }> {
  const sub = resolveSubtype(subtypeValue);

  if (sub.restricted) {
    const path = `clients/${slug}/${sub.segment}`;
    const folderId = await findOrCreateFolder({
      clientId,
      path,
      displayName: sub.displayName,
      visibility: 'restricted',
      allowedRoles: ['admin'],
    });
    return { folderId, folderPath: path };
  }

  const uploadsPath = `clients/${slug}/uploads`;
  const uploadsId = await findOrCreateFolder({ clientId, path: uploadsPath, displayName: 'Uploads' });
  if (sub.value === 'other') return { folderId: uploadsId, folderPath: uploadsPath };

  const path = `clients/${slug}/${sub.segment}`;
  const folderId = await findOrCreateFolder({ clientId, path, displayName: sub.displayName });
  return { folderId, folderPath: path };
}

export interface UploadDocumentInput {
  readonly clientId: string;
  readonly folderId: string | null;
  readonly r2Key: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly status?: DocumentStatus;
  readonly documentType?: DocumentType;
  /**
   * INTERNAL `users.id` of the uploader (not the Logto subject). Attribution is what
   * makes "delete files you uploaded" (`file.deleteOwn`) enforceable — the column
   * existed but was never populated, so every upload looked system-owned.
   */
  readonly uploadedByUserId?: string | null;
}

/** Insert the `documents` row for an upload; returns the new document id. */
export async function insertUploadDocument(input: UploadDocumentInput): Promise<string> {
  const db = getServerClient();
  const insert: Database['public']['Tables']['documents']['Insert'] = {
    client_id: input.clientId,
    folder_id: input.folderId,
    document_type: input.documentType ?? 'upload',
    source_badge: 'upload',
    r2_key: input.r2Key,
    file_name: input.fileName,
    file_size: input.fileSize,
    status: input.status ?? 'ready',
    uploaded_by_user_id: input.uploadedByUserId ?? null,
  };
  const { data, error } = await db.from('documents').insert(insert).select('id').single();
  if (error !== null) throw new Error(`insertUploadDocument: ${error.message}`);
  return data.id;
}
