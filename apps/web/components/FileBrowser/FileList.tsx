'use client';

import { Download, MoreHorizontal, MoveRight } from 'lucide-react';
import type { Document } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { TYPE } from '@/lib/typography';
import { formatEasternDate } from '@/lib/format';
import { docStatusBadge, formatFileSize, sourceBadge } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * FileList (docs/08 §8 M11) — right panel of the file browser.
 *
 * Columns: Name, Type badge (Meeting blue / Upload purple / Auto emerald), Date,
 * Uploaded By, Size, Status badge (Ready / Requires Review / Delivered). The
 * action icons (Download / Move / More) are shown ONLY when `canEdit` (D14);
 * viewers get a read-only list. Action handlers are visual-only in Phase 1A/2
 * (no real download/move — wired in Phase 1B).
 */
export interface FileListProps {
  readonly documents: readonly Document[];
  readonly canEdit: boolean;
}

export function FileList({ documents, canEdit }: FileListProps): React.JSX.Element {
  if (documents.length === 0) {
    return (
      <EmptyState
        title="No files here"
        description="This folder has no documents yet. Generated and uploaded files will appear here."
      />
    );
  }

  return (
    <Table>
      <THead>
        <TH>Name</TH>
        <TH>Type</TH>
        <TH>Date</TH>
        <TH>Uploaded By</TH>
        <TH>Size</TH>
        <TH>Status</TH>
        {canEdit ? (
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        ) : null}
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
              {canEdit ? (
                <TCell>
                  <span className="flex items-center gap-1">
                    <FileAction label={`Download ${doc.fileName}`} icon={<Download size={16} />} />
                    <FileAction label={`Move ${doc.fileName}`} icon={<MoveRight size={16} />} />
                    <FileAction label={`More actions for ${doc.fileName}`} icon={<MoreHorizontal size={16} />} />
                  </span>
                </TCell>
              ) : null}
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
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1"
      style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
    >
      {icon}
    </button>
  );
}
