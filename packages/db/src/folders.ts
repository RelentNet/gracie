/**
 * Folder filing helper — shared by the web upload path and the worker generation
 * path so both agree on how documents are filed into `folders` (docs/04, docs/08).
 *
 * Folders are keyed by a unique `path` (the R2 prefix — see `uq_folders_path`).
 * `findOrCreateFolder` is the "drive-feel" primitive: it resolves the folder row
 * for a path, creating it on first use, so callers can set `documents.folder_id`
 * without pre-seeding a folder tree.
 *
 * NO `server-only` import here: this module is imported by BOTH the Next web app
 * and the Fastify worker (a plain Node process). It uses the service-role client
 * (bypasses RLS); the `restricted`-visibility SECURITY gate is enforced at the
 * read/API layer (docs/02 §D14), not here.
 */
import { getServerClient } from './client.js';
import type { Database } from './types.js';

type FolderVisibility = Database['public']['Enums']['folder_visibility'];
type UserRole = Database['public']['Enums']['user_role'];

/** Postgres unique-violation SQLSTATE — a concurrent create raced us to the path. */
const UNIQUE_VIOLATION = '23505';

const ALL_ROLES: readonly UserRole[] = ['admin', 'standard', 'viewer'];

export interface FindOrCreateFolderInput {
  /** Owning client, or `null` for a global folder (e.g. knowledge base). */
  readonly clientId: string | null;
  /** Unique R2 prefix that identifies the folder (e.g. `clients/acme/uploads`). */
  readonly path: string;
  /** Human label shown in the file browser (e.g. `Uploads`). */
  readonly displayName: string;
  /** Defaults to `all`. `restricted` folders are admin-only (docs/02 §D14). */
  readonly visibility?: FolderVisibility;
  /** Defaults to all three roles (or `['admin']` when `restricted`). */
  readonly allowedRoles?: readonly UserRole[];
  readonly createdByUserId?: string | null;
  /**
   * `'client'` (default) for per-client document folders, or `'staff'` for the
   * Gracie Files staff drive (GF, migration 0011). The discriminator keeps the
   * staff tree out of the client Documents views and vice-versa.
   */
  readonly kind?: 'client' | 'staff';
}

/**
 * Return the id of the folder at `input.path`, creating it if absent. Idempotent
 * and race-safe (a concurrent insert that hits the unique `path` index is
 * recovered by re-selecting). An existing folder is returned as-is — its stored
 * `displayName`/`visibility` are NOT overwritten.
 */
export async function findOrCreateFolder(input: FindOrCreateFolderInput): Promise<string> {
  const db = getServerClient();

  const existing = await db.from('folders').select('id').eq('path', input.path).maybeSingle();
  if (existing.error !== null) {
    throw new Error(`findOrCreateFolder select: ${existing.error.message}`);
  }
  if (existing.data !== null) return existing.data.id;

  const visibility: FolderVisibility = input.visibility ?? 'all';
  const allowedRoles =
    input.allowedRoles ?? (visibility === 'restricted' ? (['admin'] as const) : ALL_ROLES);

  const insert: Database['public']['Tables']['folders']['Insert'] = {
    client_id: input.clientId,
    path: input.path,
    display_name: input.displayName,
    visibility,
    allowed_roles: [...allowedRoles],
    created_by_user_id: input.createdByUserId ?? null,
    kind: input.kind ?? 'client',
  };

  const inserted = await db.from('folders').insert(insert).select('id').single();
  if (inserted.error !== null) {
    if (inserted.error.code === UNIQUE_VIOLATION) {
      const retry = await db.from('folders').select('id').eq('path', input.path).single();
      if (retry.error !== null) throw new Error(`findOrCreateFolder retry: ${retry.error.message}`);
      return retry.data.id;
    }
    throw new Error(`findOrCreateFolder insert: ${inserted.error.message}`);
  }
  return inserted.data.id;
}
