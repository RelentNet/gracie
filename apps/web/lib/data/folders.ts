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
import type { Folder } from '@gracie/shared';

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

/** Fetch a single folder by id, or null if not found. */
export async function getFolderById(id: string): Promise<Folder | null> {
  const db = getServerClient();
  const { data, error } = await db.from('folders').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getFolderById: ${error.message}`);
  return data === null ? null : mapFolder(data);
}

export interface CreateFolderInput {
  readonly clientId: string | null;
  readonly path: string;
  readonly displayName: string;
  readonly restricted: boolean;
  readonly createdByUserId: string | null;
  /** `'client'` (default) or `'staff'` for the Gracie Files drive (GF, 0011). */
  readonly kind?: 'client' | 'staff';
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
    kind: input.kind ?? 'client',
  });
  const folder = await getFolderById(id);
  if (folder === null) throw new Error('createFolder: folder vanished after create');
  return folder;
}
