import type {
  DocumentSource,
  DocumentStatus,
  DocumentType,
  FolderVisibility,
} from '../constants/enums.js';
import type { Role } from '../constants/roles.js';
import type { ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * `folders` table (docs/04) — the R2 permission layer. `null` clientId = global
 * (e.g. knowledge-base). `restricted` visibility (e.g. Transcripts) is hidden
 * from roles not in `allowedRoles`.
 */
export interface Folder {
  readonly id: UUID;
  readonly clientId: UUID | null;
  readonly path: string;
  readonly displayName: string;
  readonly visibility: FolderVisibility;
  readonly allowedRoles: readonly Role[];
  readonly createdByUserId: UUID | null;
  readonly createdAt: ISOTimestamp;
}

/**
 * `documents` table (docs/04). Documents 3 (client summary) and 6 (client email
 * draft) are generated with `requiresReview = true` and are NEVER auto-sent.
 */
export interface Document extends Timestamps {
  readonly id: UUID;
  readonly meetingId: UUID | null;
  readonly clientId: UUID | null;
  readonly folderId: UUID | null;
  readonly documentType: DocumentType;
  readonly sourceBadge: DocumentSource;
  readonly r2Key: string;
  readonly fileName: string;
  readonly fileSize: number | null;
  readonly requiresReview: boolean;
  readonly status: DocumentStatus;
  readonly uploadedByUserId: UUID | null;
}
