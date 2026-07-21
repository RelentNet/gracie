/**
 * Server-side data access for folder mutations (docs/plan p2fix §3).
 *
 * The read side (list/filter) lives in `lib/data/documents.ts`; this module adds
 * the create path used by `POST /api/folders` (editors create subfolders; Admins
 * may mark them restricted). Uses the service-role client (bypasses RLS);
 * permission enforcement is the API layer's job (docs/02 §D14). Server-only.
 *
 * SECURITY-CRITICAL: a `restricted` folder is Admin-only. The API must reject a
 * restricted-folder create from a non-admin BEFORE calling `createFolder`.
 */
import 'server-only';

import { findOrCreateFolder, getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import { isUnderPath } from '@gracie/shared';
import type { Folder, FolderVisibility, Role } from '@gracie/shared';

import { mapFolder } from '../mappers/document.js';

/** URL/path-safe segment from a folder name (fallback `folder` for empty input). */
export function folderSegment(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'folder' : slug;
}

/** Fetch a single folder by id, or null if not found. Includes recycled folders. */
export async function getFolderById(id: string): Promise<Folder | null> {
  const db = getServerClient();
  const { data, error } = await db.from('folders').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getFolderById: ${error.message}`);
  return data === null ? null : mapFolder(data);
}

/** Rename and/or re-permission a folder. Never touches `path`. */
export interface FolderPatch {
  readonly displayName?: string;
  readonly visibility?: FolderVisibility;
  readonly allowedRoles?: readonly Role[];
}

/**
 * Apply a metadata patch to a folder.
 *
 * RENAME IS METADATA-ONLY, AND MUST STAY THAT WAY. `folders.path` is the folder's
 * real identity: it is UNIQUE, it is the prefix `canAccessKey` authorizes against,
 * every object key beneath it embeds it, and the folder TREE is reconstructed purely
 * from path prefixes (there is no `parent_folder_id`). Rewriting `path` on rename
 * would silently reparent every descendant and orphan every object under it. So a
 * rename changes `display_name` only — the stored bytes never move.
 */
export async function updateFolder(id: string, patch: FolderPatch): Promise<Folder | null> {
  const db = getServerClient();
  const update: Database['public']['Tables']['folders']['Update'] = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.allowedRoles !== undefined) update.allowed_roles = [...patch.allowedRoles];
  if (Object.keys(update).length === 0) return getFolderById(id);

  const { data, error } = await db
    .from('folders')
    .update(update)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateFolder: ${error.message}`);
  return data === null ? null : mapFolder(data);
}

/** Every live folder at or below `path` (self included), by path containment. */
export async function listFolderSubtree(path: string): Promise<Folder[]> {
  const db = getServerClient();
  const { data, error } = await db.from('folders').select('*').is('deleted_at', null);
  if (error !== null) throw new Error(`listFolderSubtree: ${error.message}`);
  // Filtered in JS via `isUnderPath` rather than a SQL LIKE: the boundary rule must
  // be identical to the one authorization uses, and a LIKE 'p%' would also match a
  // sibling like `<p>-public`, cascading a delete into a folder we do not own.
  return (data ?? []).filter((row) => isUnderPath(row.path, path)).map(mapFolder);
}

/** What a recursive folder delete touched — surfaced so the UI can confirm counts. */
export interface FolderDeleteResult {
  readonly batchId: string;
  readonly folderIds: readonly string[];
  readonly documentIds: readonly string[];
}

/**
 * Recursively move a folder, its descendant folders, and every document inside them
 * to the recycle bin under ONE `delete_batch_id`.
 *
 * The shared batch id is what makes Restore able to return the subtree as a unit
 * instead of stranding children in the bin with no way to reach them.
 *
 * Not a single transaction (supabase-js has no multi-statement transaction). Order is
 * chosen so a mid-way failure fails SAFE: documents are stamped FIRST, so the worst
 * case is documents in the bin under a still-live folder — visibly wrong and
 * recoverable — rather than a live-looking folder whose contents are silently
 * unreachable. Restore is tolerant of a partial batch for the same reason.
 */
export async function softDeleteFolderCascade(
  folder: Folder,
  deletedByUserId: string | null,
  batchId: string,
): Promise<FolderDeleteResult> {
  const db = getServerClient();
  const subtree = await listFolderSubtree(folder.path);
  const folderIds = subtree.map((f) => f.id);
  const stamp = {
    deleted_at: new Date().toISOString(),
    deleted_by_user_id: deletedByUserId,
    delete_batch_id: batchId,
  };

  const docs = await db
    .from('documents')
    .update(stamp)
    .in('folder_id', folderIds)
    .is('deleted_at', null)
    .select('id');
  if (docs.error !== null) throw new Error(`softDeleteFolderCascade(documents): ${docs.error.message}`);

  const folders = await db
    .from('folders')
    .update(stamp)
    .in('id', folderIds)
    .is('deleted_at', null)
    .select('id');
  if (folders.error !== null) throw new Error(`softDeleteFolderCascade: ${folders.error.message}`);

  return {
    batchId,
    folderIds: (folders.data ?? []).map((r) => r.id),
    documentIds: (docs.data ?? []).map((r) => r.id),
  };
}

/** Restore every folder and document sharing a delete batch. Returns doc ids to re-ingest. */
export async function restoreDeleteBatch(batchId: string): Promise<string[]> {
  const db = getServerClient();
  const clear = { deleted_at: null, deleted_by_user_id: null, delete_batch_id: null };

  const folders = await db.from('folders').update(clear).eq('delete_batch_id', batchId);
  if (folders.error !== null) throw new Error(`restoreDeleteBatch(folders): ${folders.error.message}`);

  const docs = await db
    .from('documents')
    .update(clear)
    .eq('delete_batch_id', batchId)
    .select('id');
  if (docs.error !== null) throw new Error(`restoreDeleteBatch(documents): ${docs.error.message}`);
  return (docs.data ?? []).map((r) => r.id);
}

/**
 * Restore the chain of deleted ancestors above `path`, so a restored item lands
 * somewhere the user can actually navigate to.
 *
 * Without this, restoring a single file whose parent folder is still in the bin would
 * return it to an invisible location — present in the DB, absent from the tree.
 */
export async function restoreAncestorFolders(path: string): Promise<number> {
  const db = getServerClient();
  const { data, error } = await db
    .from('folders')
    .select('id, path')
    .not('deleted_at', 'is', null);
  if (error !== null) throw new Error(`restoreAncestorFolders: ${error.message}`);

  const ancestorIds = (data ?? []).filter((row) => isUnderPath(path, row.path)).map((r) => r.id);
  if (ancestorIds.length === 0) return 0;

  const restored = await db
    .from('folders')
    .update({ deleted_at: null, deleted_by_user_id: null, delete_batch_id: null })
    .in('id', ancestorIds);
  if (restored.error !== null) {
    throw new Error(`restoreAncestorFolders(update): ${restored.error.message}`);
  }
  return ancestorIds.length;
}

export interface CreateFolderInput {
  readonly clientId: string | null;
  readonly path: string;
  readonly displayName: string;
  readonly restricted: boolean;
  readonly createdByUserId: string | null;
}

/**
 * Create a subfolder (idempotent by unique `path` — returns the existing row if a
 * folder already sits at that path). `restricted` → Admin-only visibility.
 */
export async function createFolder(input: CreateFolderInput): Promise<Folder> {
  const id = await findOrCreateFolder({
    clientId: input.clientId,
    path: input.path,
    displayName: input.displayName,
    visibility: input.restricted ? 'restricted' : 'all',
    allowedRoles: input.restricted ? ['admin'] : ['admin', 'standard', 'viewer'],
    createdByUserId: input.createdByUserId,
  });
  const folder = await getFolderById(id);
  if (folder === null) throw new Error('createFolder: folder vanished after create');
  return folder;
}
