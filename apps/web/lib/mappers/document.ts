/**
 * Row mappers for documents + folders — convert raw Supabase rows (snake_case)
 * to the camelCase domain types in `@gracie/shared`. Keeps the DB↔domain
 * boundary explicit, mirroring lib/mappers.ts (the clients template).
 *
 * Restricted-folder visibility (the security-critical omission) is NOT decided
 * here — mappers are pure shape converters. The API layer omits restricted
 * folders and their documents for non-admins (docs/02 §D14).
 */
import type { Database } from '@gracie/db';
import type { Document, Folder } from '@gracie/shared';

type DocumentRow = Database['public']['Tables']['documents']['Row'];
type FolderRow = Database['public']['Tables']['folders']['Row'];

export function mapDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    clientId: row.client_id,
    folderId: row.folder_id,
    documentType: row.document_type,
    sourceBadge: row.source_badge,
    r2Key: row.r2_key,
    fileName: row.file_name,
    fileSize: row.file_size,
    requiresReview: row.requires_review,
    status: row.status,
    uploadedByUserId: row.uploaded_by_user_id,
    visibility: row.visibility,
    allowedRoles: row.allowed_roles,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
    deleteBatchId: row.delete_batch_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    clientId: row.client_id,
    path: row.path,
    displayName: row.display_name,
    visibility: row.visibility,
    allowedRoles: row.allowed_roles,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
    deleteBatchId: row.delete_batch_id,
  };
}
