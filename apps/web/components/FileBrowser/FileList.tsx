'use client';

import { Download, MoveRight, Trash2 } from 'lucide-react';
import type { Document } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatEasternDate } from '@/lib/format';
import { docStatusBadge, formatFileSize, sourceBadge } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * FileList (docs/08 §8 M11) — right panel of the file browser.
 *
 * Columns: Name, (Client — global view only), Type badge (Meeting blue / Upload
 * purple / Auto emerald), Date, Uploaded By, Size, Status badge. Download works
 * for ALL roles (real presigned-URL download); Move is editor-only (D14) and
 * opens the caller's move modal via `onMove`.
 */
export interface FileListProps {
  readonly documents: readonly Document[];
  readonly canEdit: boolean;
  /** Global view adds a Client column; `clientName` resolves ids to names. */
  readonly showClient?: boolean;
  readonly clientName?: (clientId: string | null) => string;
  /** Editor-only: open the move/refile flow for a document. */
  readonly onMove?: (doc: Document) => void;
  /** Editor/admin-only: open the delete-confirmation flow (Gracie Files). */
  readonly onDelete?: (doc: Document) => void;
}

interface PresignResponse {
  readonly url: string;
}

async function downloadDocument(doc: Document): Promise<void> {
  const { url } = await apiClient.get<PresignResponse>(
    `/api/files/url?key=${encodeURIComponent(doc.r2Key)}&action=get`,
  );
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function FileList({
  documents,
  canEdit,
  showClient = false,
  clientName,
  onMove,
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
                <span style={TYPE.bodyStrong}>{doc.fileName}</span>
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
              <TCell>{formatEasternDate(doc.createdAt)}</TCell>
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
                    <FileAction
                      label={`Move ${doc.fileName}`}
                      icon={<MoveRight size={16} />}
                      onClick={onMove !== undefined ? (): void => onMove(doc) : undefined}
                    />
                  ) : null}
                  {onDelete !== undefined ? (
                    <FileAction
                      label={`Delete ${doc.fileName}`}
                      icon={<Trash2 size={16} />}
                      danger
                      onClick={(): void => onDelete(doc)}
                    />
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

function FileAction({
  label,
  icon,
  onClick,
  danger = false,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onClick?: () => void;
  /** Render in the destructive color (delete). */
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
        color: danger ? 'var(--color-red-500)' : 'var(--text-secondary)',
        background: 'transparent',
        cursor: onClick === undefined ? 'default' : 'pointer',
        opacity: onClick === undefined ? 0.4 : 1,
      }}
    >
      {icon}
    </button>
  );
}
