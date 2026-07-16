/**
 * Server-side data access for Gracie Files (GF) — the staff/team working drive.
 *
 * GF is NOT a new storage/ingest lane. It is the EXISTING documents/folders stack,
 * owned by the internal "Grace & Associates" org's `client_id`, rooted at the
 * `staff/` object-key prefix, and discriminated from client documents by
 * `folders.kind = 'staff'` (migration 0011). Because staff documents carry the
 * internal org's `client_id` and `source_type='upload'` embeddings, they flow
 * through the existing ingest pipeline AND the company-aware Assistant's
 * `match_all_embeddings` retrieval with zero new code — restricted staff folders
 * are hidden from non-admins by the SAME `filterChunksByFolderVisibility` gate that
 * governs client documents.
 *
 * Uses the service-role client (bypasses RLS); permission enforcement is the API
 * layer's job (docs/02 §D14). Server-only.
 */
import 'server-only';

import { findOrCreateFolder, getServerClient } from '@gracie/db';
import type { Document, Folder } from '@gracie/shared';

import { mapDocument, mapFolder } from '../mappers/document.js';

/** Object-key prefix + folder path of the staff-drive root. */
export const STAFF_ROOT = 'staff';
/** Display name of the staff-drive root folder shown in the browser. */
export const STAFF_ROOT_NAME = 'Gracie Files';

/**
 * Resolve the internal "Grace & Associates" org id — the owner of the staff drive.
 * Mirrors the calendar-scan/generate lookup (oldest `type='internal'` client).
 * Returns null when no internal org exists yet (a fresh install before seeding).
 */
export async function getInternalOrgId(): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('clients')
    .select('id')
    .eq('type', 'internal')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new Error(`getInternalOrgId: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Ensure the `staff/` root folder exists and return it together with the owning
 * internal org id. Idempotent (find-or-create by unique path). Throws when there is
 * no internal org to own the drive — the caller surfaces that as a clear error.
 */
export async function ensureStaffRoot(): Promise<{ orgId: string; rootFolderId: string }> {
  const orgId = await getInternalOrgId();
  if (orgId === null) {
    throw new Error(
      'Gracie Files: no internal "Grace & Associates" org exists to own the staff drive.',
    );
  }
  const rootFolderId = await findOrCreateFolder({
    clientId: orgId,
    path: STAFF_ROOT,
    displayName: STAFF_ROOT_NAME,
    kind: 'staff',
  });
  return { orgId, rootFolderId };
}

/** List every staff-drive folder (`kind='staff'`), ordered by path. */
export async function listStaffFolders(): Promise<Folder[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('folders')
    .select('*')
    .eq('kind', 'staff')
    .order('path', { ascending: true });
  if (error !== null) throw new Error(`listStaffFolders: ${error.message}`);
  return (data ?? []).map(mapFolder);
}

/** Fetch a staff folder by id, or null if it does not exist / is not a staff folder. */
export async function getStaffFolderById(id: string): Promise<Folder | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('folders')
    .select('*')
    .eq('id', id)
    .eq('kind', 'staff')
    .maybeSingle();
  if (error !== null) throw new Error(`getStaffFolderById: ${error.message}`);
  return data === null ? null : mapFolder(data);
}

/** List every document filed in a staff-drive folder, newest first. */
export async function listStaffDocuments(): Promise<Document[]> {
  const folders = await listStaffFolders();
  const folderIds = folders.map((folder) => folder.id);
  if (folderIds.length === 0) return [];
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .select('*')
    .in('folder_id', folderIds)
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(`listStaffDocuments: ${error.message}`);
  return (data ?? []).map(mapDocument);
}

/**
 * Fetch a document by id ONLY if it belongs to the staff drive (its folder is a
 * `kind='staff'` folder). Returns the document + its owning staff folder, or null
 * when the id is unknown or is a client document (keeps the staff routes from
 * mutating client documents).
 */
export async function getStaffDocument(
  documentId: string,
): Promise<{ document: Document; folder: Folder } | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (error !== null) throw new Error(`getStaffDocument: ${error.message}`);
  if (data === null || data.folder_id === null) return null;
  const folder = await getStaffFolderById(data.folder_id);
  if (folder === null) return null;
  return { document: mapDocument(data), folder };
}

/** A staff folder plus every descendant folder + document (for recursive delete). */
export interface StaffFolderSubtree {
  /** The target folder and all folders nested beneath it (by path prefix). */
  readonly folders: readonly Folder[];
  /** Every document filed anywhere in that subtree. */
  readonly documents: readonly Document[];
}

/**
 * Collect a staff folder's full subtree — itself + every descendant staff folder
 * (matched by `path` prefix, the same nesting model the tree builder uses) and all
 * documents filed in any of them. Backs the recursive folder delete.
 */
export async function getStaffFolderSubtree(folder: Folder): Promise<StaffFolderSubtree> {
  const all = await listStaffFolders();
  const prefix = `${folder.path}/`;
  const folders = all.filter((f) => f.path === folder.path || f.path.startsWith(prefix));
  const folderIds = folders.map((f) => f.id);

  const db = getServerClient();
  const { data, error } = await db.from('documents').select('*').in('folder_id', folderIds);
  if (error !== null) throw new Error(`getStaffFolderSubtree: ${error.message}`);
  return { folders, documents: (data ?? []).map(mapDocument) };
}

/**
 * Delete a document's DB records: its upload embeddings first (closing the
 * orphaned-embedding gap), then the `documents` row. The MinIO object is removed
 * separately by the route (storage lives at the API edge). Idempotent per id.
 */
export async function deleteDocumentRecords(documentId: string): Promise<void> {
  const db = getServerClient();
  const embeddings = await db
    .from('embeddings')
    .delete()
    .eq('source_type', 'upload')
    .eq('source_id', documentId);
  if (embeddings.error !== null) {
    throw new Error(`deleteDocumentRecords(embeddings): ${embeddings.error.message}`);
  }
  const doc = await db.from('documents').delete().eq('id', documentId);
  if (doc.error !== null) throw new Error(`deleteDocumentRecords(document): ${doc.error.message}`);
}

/** Delete a set of (already-emptied) staff folder rows by id. */
export async function deleteFolderRecords(folderIds: readonly string[]): Promise<void> {
  if (folderIds.length === 0) return;
  const db = getServerClient();
  const { error } = await db.from('folders').delete().in('id', [...folderIds]);
  if (error !== null) throw new Error(`deleteFolderRecords: ${error.message}`);
}
