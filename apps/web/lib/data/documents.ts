/**
 * Server-side data access for documents + folders (Phase 1B).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement
 * is the API layer's job (docs/02 §D14). Runs only on the server — never import
 * this into a client component. Mirrors lib/data/clients.ts.
 *
 * SECURITY-CRITICAL — restricted-folder omission (docs/08 §1/§7, D14):
 * `restricted`-visibility folders (e.g. Transcripts) are OMITTED entirely for
 * roles not in `allowedRoles`. `filterVisibleFolders` and `filterVisibleDocuments`
 * below implement that omission and MUST be applied in the API before any folder
 * or document reaches a non-admin client. This mirrors FileBrowser's
 * `isVisibleToRole` (admins-only for restricted folders).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import { canRoleSee, isUnderPath, toVisibilityRule } from '@gracie/shared';
import type { Document, Folder, FolderVisibility, Role } from '@gracie/shared';

import { mapDocument, mapFolder } from '../mappers/document.js';

interface ListDocumentsOptions {
  readonly clientId?: string;
}

/**
 * List LIVE folders — all, or scoped to one client when `clientId` is provided.
 * Recycle-bin rows are excluded here (and in every other normal listing); the bin
 * has its own reader, `listTrash`.
 */
export async function listFolders(clientId?: string): Promise<Folder[]> {
  const db = getServerClient();
  let query = db
    .from('folders')
    .select('*')
    .is('deleted_at', null)
    .order('path', { ascending: true });
  if (clientId !== undefined) {
    query = query.eq('client_id', clientId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listFolders: ${error.message}`);
  return (data ?? []).map(mapFolder);
}

/**
 * List LIVE documents — global, or scoped to one client via `opts.clientId`.
 * Ordered newest first (created_at desc). Deleted rows are excluded.
 */
export async function listDocuments(opts?: ListDocumentsOptions): Promise<Document[]> {
  const db = getServerClient();
  let query = db
    .from('documents')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (opts?.clientId !== undefined) {
    query = query.eq('client_id', opts.clientId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listDocuments: ${error.message}`);
  return (data ?? []).map(mapDocument);
}

/** An org that owns at least one folder or document, with its display name. */
export interface DocumentOwnerOrg {
  readonly id: string;
  readonly name: string;
}

/**
 * List the orgs that ACTUALLY OWN a folder or a document, with their display
 * name — regardless of party type (internal, partner, client, lead, prospect).
 *
 * This backs the global Documents tree + id→name map (docs/plan documents-area
 * bugs): every org holding docs gets a node with the correct name, and doc-less
 * orgs are omitted. Unlike `GET /api/clients` (which defaults to real `client`s
 * and whose `?type=all` still excludes internal), this is NOT type-filtered, so
 * the internal Grace & Associates workspace — which owns generated meeting docs
 * — is included and no longer renders as "Unknown Client".
 */
export async function listDocumentOwnerOrgs(): Promise<DocumentOwnerOrg[]> {
  const db = getServerClient();
  const [folders, documents] = await Promise.all([
    db.from('folders').select('client_id'),
    db.from('documents').select('client_id'),
  ]);
  if (folders.error) throw new Error(`listDocumentOwnerOrgs(folders): ${folders.error.message}`);
  if (documents.error) {
    throw new Error(`listDocumentOwnerOrgs(documents): ${documents.error.message}`);
  }

  const ownerIds = new Set<string>();
  for (const row of folders.data ?? []) if (row.client_id !== null) ownerIds.add(row.client_id);
  for (const row of documents.data ?? []) if (row.client_id !== null) ownerIds.add(row.client_id);
  if (ownerIds.size === 0) return [];

  const { data, error } = await db.from('clients').select('id, name').in('id', [...ownerIds]);
  if (error) throw new Error(`listDocumentOwnerOrgs(clients): ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** List documents in a single folder, ordered newest first. */
export async function getDocumentsByFolder(folderId: string): Promise<Document[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('folder_id', folderId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`getDocumentsByFolder: ${error.message}`);
  return (data ?? []).map(mapDocument);
}

/** Fetch a single document by id, or null if not found. */
export async function getDocumentById(id: string): Promise<Document | null> {
  const db = getServerClient();
  const { data, error } = await db.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getDocumentById: ${error.message}`);
  return data === null ? null : mapDocument(data);
}

/**
 * Refile a document: set its `folder_id` (and, when the object moved, its
 * `r2_key`) and bump `updated_at`. Used by the move/refile API (docs/plan p2fix §4).
 */
export async function moveDocumentToFolder(
  documentId: string,
  folderId: string,
  r2Key: string,
): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('documents')
    .update({ folder_id: folderId, r2_key: r2Key, updated_at: new Date().toISOString() })
    .eq('id', documentId);
  if (error) throw new Error(`moveDocumentToFolder: ${error.message}`);
}

/** Rename and/or re-permission a document. Never touches `r2_key`. */
export interface DocumentPatch {
  readonly fileName?: string;
  /** `null` clears the override so the file inherits its folder again. */
  readonly visibility?: FolderVisibility | null;
  readonly allowedRoles?: readonly Role[] | null;
}

/**
 * Apply a metadata patch to a document.
 *
 * RENAME IS METADATA-ONLY. `documents.file_name` is a separate column from
 * `documents.r2_key`, so a rename changes the display name and nothing else — no
 * object copy, no key rewrite, no risk to the stored bytes or to `canAccessKey`
 * (which authorizes on the key's folder prefix). Same idea as folder rename.
 */
export async function updateDocument(id: string, patch: DocumentPatch): Promise<Document | null> {
  const db = getServerClient();
  const update: Database['public']['Tables']['documents']['Update'] = {};
  if (patch.fileName !== undefined) update.file_name = patch.fileName;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.allowedRoles !== undefined) {
    update.allowed_roles = patch.allowedRoles === null ? null : [...patch.allowedRoles];
  }
  if (Object.keys(update).length === 0) return getDocumentById(id);

  const { data, error } = await db
    .from('documents')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateDocument: ${error.message}`);
  return data === null ? null : mapDocument(data);
}

/**
 * Move a document to the recycle bin and drop its embeddings.
 *
 * The embeddings deletion is not incidental cleanup — `embeddings.source_id` is a
 * polymorphic reference with NO foreign key, so nothing cascades. Leaving the rows
 * behind would let the assistant keep quoting a document the user just deleted,
 * which is a confidentiality leak, not just staleness. Removing them makes the leak
 * structurally impossible rather than dependent on every retrieval query remembering
 * to filter. Restore re-enqueues ingestion to rebuild them.
 *
 * `deleted_at is null` in the WHERE makes this idempotent: a double delete is a
 * no-op returning null rather than re-stamping a new timestamp (which would silently
 * extend the retention window).
 */
export async function softDeleteDocument(
  id: string,
  deletedByUserId: string | null,
  batchId: string,
): Promise<Document | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: deletedByUserId,
      delete_batch_id: batchId,
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`softDeleteDocument: ${error.message}`);
  if (data === null) return null;

  // `source_type='upload'` is what the ingest pipeline writes for a `documents` row
  // (apps/worker ingest.processor). Generated meeting docs are not embedded per-doc —
  // only the transcript is, keyed by MEETING id — so deleting one generated document
  // deliberately leaves the meeting's transcript embeddings alone.
  const cleared = await db
    .from('embeddings')
    .delete()
    .eq('source_type', 'upload')
    .eq('source_id', id);
  if (cleared.error !== null) {
    throw new Error(`softDeleteDocument embeddings: ${cleared.error.message}`);
  }
  return mapDocument(data);
}

/** Bring a document back from the recycle bin. Caller re-enqueues ingestion. */
export async function restoreDocument(id: string): Promise<Document | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('documents')
    .update({ deleted_at: null, deleted_by_user_id: null, delete_batch_id: null })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`restoreDocument: ${error.message}`);
  return data === null ? null : mapDocument(data);
}

/**
 * Recycle-bin contents.
 *
 * `deletedByUserId` scopes the result to one user's own deletions (standard users);
 * pass null for the unrestricted admin view. Folders come back too, so the bin can
 * show a deleted subtree as one restorable folder rather than as loose files.
 */
export async function listTrash(
  deletedByUserId: string | null,
): Promise<{ documents: Document[]; folders: Folder[] }> {
  const db = getServerClient();
  let docQuery = db
    .from('documents')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: true });
  let folderQuery = db
    .from('folders')
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: true });
  if (deletedByUserId !== null) {
    docQuery = docQuery.eq('deleted_by_user_id', deletedByUserId);
    folderQuery = folderQuery.eq('deleted_by_user_id', deletedByUserId);
  }

  const [docs, folders] = await Promise.all([docQuery, folderQuery]);
  if (docs.error !== null) throw new Error(`listTrash(documents): ${docs.error.message}`);
  if (folders.error !== null) throw new Error(`listTrash(folders): ${folders.error.message}`);

  // A folder delete stamps its whole subtree, so the bin would otherwise list every
  // descendant file alongside the folder the user actually deleted. Show only the
  // items that head their batch: the folder itself, and files deleted on their own.
  const batchFolderIds = new Set(
    (folders.data ?? [])
      .filter((f) => f.delete_batch_id !== null)
      .map((f) => f.delete_batch_id as string),
  );
  const topLevelDocs = (docs.data ?? []).filter(
    (d) => d.delete_batch_id === null || !batchFolderIds.has(d.delete_batch_id),
  );
  const topLevelFolders = dropNestedFolders(folders.data ?? []);

  return {
    documents: topLevelDocs.map(mapDocument),
    folders: topLevelFolders.map(mapFolder),
  };
}

/** Within one delete batch only the highest folder is shown; descendants are implied. */
function dropNestedFolders<T extends { path: string; delete_batch_id: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter(
    (row) =>
      !rows.some(
        (other) =>
          other !== row &&
          other.delete_batch_id === row.delete_batch_id &&
          other.path.length < row.path.length &&
          isUnderPath(row.path, other.path),
      ),
  );
}

/**
 * SECURITY-CRITICAL. Omit restricted folders the role may not see.
 *
 * Delegates to the shared resolver, so `allowed_roles` is now honoured as a real
 * role list: a folder restricted to `{admin,standard}` is visible to a standard
 * user, which the previous admin-only reduction made impossible to express.
 */
export function filterVisibleFolders(folders: readonly Folder[], role: Role): Folder[] {
  return folders.filter((folder) =>
    canRoleSee(toVisibilityRule(folder.visibility, folder.allowedRoles), role),
  );
}

/**
 * SECURITY-CRITICAL. Omit documents the role may not see.
 *
 * Two gates, in order: the governing folder (a document in a hidden folder is never
 * returned — pass the ALREADY-FILTERED folder set), then the document's own override
 * if it has one. Unfiled documents (`folderId === null`) have no folder ceiling.
 *
 * Note this no longer short-circuits for admins: an admin still sees everything,
 * because `canRoleSee` grants `folder.viewRestricted`, but routing admins through the
 * same code path means there is only one rule to reason about — and it keeps a future
 * non-admin-visible override from being silently skipped for admins.
 */
export function filterVisibleDocuments(
  documents: readonly Document[],
  visibleFolders: readonly Folder[],
  role: Role,
): Document[] {
  const visibleFolderIds = new Set(visibleFolders.map((folder) => folder.id));
  return documents.filter((doc) => {
    if (doc.folderId !== null && !visibleFolderIds.has(doc.folderId)) return false;
    return canRoleSee(toVisibilityRule(doc.visibility, doc.allowedRoles), role);
  });
}
