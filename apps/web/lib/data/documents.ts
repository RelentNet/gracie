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
import type { Document, Folder } from '@gracie/shared';

import { mapDocument, mapFolder } from '../mappers/document.js';

interface ListDocumentsOptions {
  readonly clientId?: string;
}

/** Folder discriminator (GF, migration 0011): per-client docs vs. the staff drive. */
export type FolderKind = 'client' | 'staff';

/**
 * List folders — all, or scoped to one client when `clientId` is provided.
 *
 * `kind` defaults to `'client'`, so the client/global Documents views (the only
 * callers) NEVER surface Gracie Files (`kind='staff'`) folders. The staff drive
 * lists its own folders via `listStaffFolders` (kind='staff').
 */
export async function listFolders(
  clientId?: string,
  kind: FolderKind = 'client',
): Promise<Folder[]> {
  const db = getServerClient();
  let query = db.from('folders').select('*').eq('kind', kind).order('path', { ascending: true });
  if (clientId !== undefined) {
    query = query.eq('client_id', clientId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listFolders: ${error.message}`);
  return (data ?? []).map(mapFolder);
}

/**
 * The ids of every `kind='staff'` folder (Gracie Files, GF). Used by the
 * client/global `GET /api/documents` route to EXCLUDE staff-drive documents from
 * the client Documents views for ALL roles — the staff drive is owned by the
 * internal GA org's `client_id`, so without this a staff file would otherwise
 * surface under the "Grace & Associates" node (and, for admins, bypass the
 * folder-based visibility filter, which is admin-passthrough).
 */
export async function listStaffFolderIds(): Promise<Set<string>> {
  const db = getServerClient();
  const { data, error } = await db.from('folders').select('id').eq('kind', 'staff');
  if (error) throw new Error(`listStaffFolderIds: ${error.message}`);
  return new Set((data ?? []).map((row) => row.id));
}

/**
 * List documents — global, or scoped to one client via `opts.clientId`.
 * Ordered newest first (created_at desc).
 */
export async function listDocuments(opts?: ListDocumentsOptions): Promise<Document[]> {
  const db = getServerClient();
  let query = db.from('documents').select('*').order('created_at', { ascending: false });
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

/**
 * SECURITY-CRITICAL. A folder is visible if it is unrestricted, or it is
 * restricted AND the requesting role is allowed. Restricted folders are
 * admin-only (mirror of FileBrowser's `isVisibleToRole`).
 */
function isVisibleToRole(folder: Folder, isAdmin: boolean): boolean {
  if (folder.visibility !== 'restricted') return true;
  return isAdmin && folder.allowedRoles.includes('admin');
}

/**
 * SECURITY-CRITICAL. Omit restricted folders the role may not see. Admins get
 * the full set; non-admins never receive a restricted folder in the response.
 */
export function filterVisibleFolders(
  folders: readonly Folder[],
  isAdmin: boolean,
): Folder[] {
  return folders.filter((folder) => isVisibleToRole(folder, isAdmin));
}

/**
 * SECURITY-CRITICAL. Omit documents that live in a hidden (restricted) folder.
 * A document is kept when it is unfiled (`folderId === null`) or its folder is
 * in the set of folders the role may see. Documents in a restricted folder are
 * never returned to a non-admin.
 */
export function filterVisibleDocuments(
  documents: readonly Document[],
  visibleFolders: readonly Folder[],
  isAdmin: boolean,
): Document[] {
  if (isAdmin) return [...documents];
  const visibleFolderIds = new Set(visibleFolders.map((folder) => folder.id));
  return documents.filter(
    (doc) => doc.folderId === null || visibleFolderIds.has(doc.folderId),
  );
}
