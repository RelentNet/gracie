'use client';

import { Download, MoveRight, Pencil, Shield, Trash2 } from 'lucide-react';
import type { Document } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { TYPE } from '@/lib/typography';
import { formatDate } from '@/lib/format';
import { docStatusBadge, formatFileSize, sourceBadge } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * FileList (docs/08 §8 M11) — right panel of the file browser.
 *
 * Columns: Name, (Client — global view only), Type badge (Meeting blue / Upload
 * purple / Auto emerald), Date, Uploaded By, Size, Status badge. Download works
 * for ALL roles (real presigned-URL download); Move / Rename / Permissions / Delete
 * are editor-only (D14) and open the caller's modals.
 *
 * A 🔒 next to the name marks a file carrying its OWN permission override — without
 * it, a locked-down file inside an open folder looks identical to its neighbours and
 * nobody can tell why a colleague cannot see it.
 */
export interface FileListProps {
  readonly documents: readonly Document[];
  readonly canEdit: boolean;
  /** Global view adds a Client column; `clientName` resolves ids to names. */
  readonly showClient?: boolean;
  readonly clientName?: (clientId: string | null) => string;
  /** Select a file → open it in the preview pane (shared by list & grid views). */
  readonly onSelect?: (doc: Document) => void;
  /** The currently-previewed file id, for the selected-row highlight. */
  readonly selectedId?: string | null;
  /** Editor-only: open the move/refile flow for a document. */
  readonly onMove?: (doc: Document) => void;
  readonly onRename?: (doc: Document) => void;
  readonly onPermissions?: (doc: Document) => void;
  /** Undefined when the caller may not delete this file (e.g. someone else's upload). */
  readonly canDelete?: (doc: Document) => boolean;
  readonly onDelete?: (doc: Document) => void;
}

/**
 * Open a document for download (shared by the list, grid and preview). Points at the
 * same-origin bytes proxy in attachment mode — NOT a presigned MinIO URL, which the
 * browser can't reach (MinIO is internal-only, docs/01 §2). The server re-checks
 * `canAccessKey` on the fetch, so no durable link to a since-deleted file lingers.
 */
export function downloadDocument(doc: Document): void {
  const url = `/api/files/raw?key=${encodeURIComponent(doc.r2Key)}&download=1&name=${encodeURIComponent(doc.fileName)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function FileList({
  documents,
  canEdit,
  showClient = false,
  clientName,
  onSelect,
  selectedId,
  onMove,
  onRename,
  onPermissions,
  canDelete,
  onDelete,
}: FileListProps): React.JSX.Element {
  if (documents.length === 0) {
    return (
      <EmptyState
        title="No files here"
        description="This folder has no documents yet. Generated and uploaded files will appear here."
      />
    );
  }

  return (
    <Table minWidth="52rem" scrollRegionLabel="Documents">
      <THead>
        <TH>Name</TH>
        {showClient ? <TH>Client</TH> : null}
        <TH>Type</TH>
        <TH>Date</TH>
        <TH>Uploaded By</TH>
        <TH>Size</TH>
        <TH>Status</TH>
        <TH>
          <span className="sr-only">Actions</span>
        </TH>
      </THead>
      <TBody>
        {documents.map((doc) => {
          const source = sourceBadge(doc.sourceBadge);
          const status = docStatusBadge(doc.status);
          return (
            <TRow key={doc.id}>
              <TCell>
                <span className="flex items-center gap-1.5">
                  {onSelect !== undefined ? (
                    <button
                      type="button"
                      onClick={(): void => onSelect(doc)}
                      className="truncate rounded text-left hover:underline"
                      title={doc.fileName}
                      style={{
                        ...TYPE.bodyStrong,
                        background: 'transparent',
                        cursor: 'pointer',
                        color: selectedId === doc.id ? 'var(--color-blue-700)' : 'var(--text-primary)',
                      }}
                    >
                      {doc.fileName}
                    </button>
                  ) : (
                    <span style={TYPE.bodyStrong}>{doc.fileName}</span>
                  )}
                  {doc.visibility === 'restricted' ? (
                    <Shield
                      aria-label="Custom permissions"
                      size={12}
                      style={{ color: 'var(--color-red-600)', flexShrink: 0 }}
                    />
                  ) : null}
                </span>
              </TCell>
              {showClient ? (
                <TCell>
                  <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
                    {clientName?.(doc.clientId) ?? 'Unassigned'}
                  </Badge>
                </TCell>
              ) : null}
              <TCell>
                <Badge bg={source.bg} fg={source.fg}>
                  {source.label}
                </Badge>
              </TCell>
              <TCell>{formatDate(doc.createdAt)}</TCell>
              <TCell>{doc.uploadedByUserId !== null ? getUserName(doc.uploadedByUserId) : 'System'}</TCell>
              <TCell>
                <span className="font-data">{formatFileSize(doc.fileSize)}</span>
              </TCell>
              <TCell>
                <Badge bg={status.bg} fg={status.fg}>
                  {status.label}
                </Badge>
              </TCell>
              <TCell>
                <span className="flex items-center gap-1">
                  <FileAction
                    label={`Download ${doc.fileName}`}
                    icon={<Download size={16} />}
                    onClick={(): void => {
                      void downloadDocument(doc);
                    }}
                  />
                  {canEdit ? (
                    <>
                      <FileAction
                        label={`Move ${doc.fileName}`}
                        icon={<MoveRight size={16} />}
                        onClick={onMove !== undefined ? (): void => onMove(doc) : undefined}
                      />
                      <FileAction
                        label={`Rename ${doc.fileName}`}
                        icon={<Pencil size={16} />}
                        onClick={onRename !== undefined ? (): void => onRename(doc) : undefined}
                      />
                      <FileAction
                        label={`Permissions for ${doc.fileName}`}
                        icon={<Shield size={16} />}
                        onClick={
                          onPermissions !== undefined ? (): void => onPermissions(doc) : undefined
                        }
                      />
                      {/* Delete is omitted entirely — not disabled — when the caller
                          may not delete this file, matching how the browser hides
                          other content a role has no rights to. */}
                      {canDelete?.(doc) === true ? (
                        <FileAction
                          label={`Delete ${doc.fileName}`}
                          icon={<Trash2 size={16} />}
                          danger
                          onClick={onDelete !== undefined ? (): void => onDelete(doc) : undefined}
                        />
                      ) : null}
                    </>
                  ) : null}
                </span>
              </TCell>
            </TRow>
          );
        })}
      </TBody>
    </Table>
  );
}

export function FileAction({
  label,
  icon,
  onClick,
  danger = false,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onClick?: () => void;
  readonly danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={onClick === undefined}
      className="rounded-md p-1"
      style={{
        color: danger ? 'var(--color-red-600)' : 'var(--text-secondary)',
        background: 'transparent',
        cursor: onClick === undefined ? 'default' : 'pointer',
        opacity: onClick === undefined ? 0.4 : 1,
      }}
    >
      {icon}
    </button>
  );
}
