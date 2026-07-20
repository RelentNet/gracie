'use client';

import { useState } from 'react';
import { Folder as FolderIcon, FileText, RotateCcw } from 'lucide-react';
import type { Document, Folder } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatEasternDate } from '@/lib/format';
import { formatFileSize } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * The Recycle Bin listing.
 *
 * Restore is the ONLY action offered. There is deliberately no Download, no Move, no
 * Open — and they are absent from the DOM rather than rendered disabled, matching how
 * this codebase already handles content a role may not act on. The API enforces the
 * same thing (`/api/files/url` refuses keys belonging to deleted rows), so removing
 * the buttons is presentation, not the control.
 */
export type TrashDocument = Document & { readonly purgesAt: string | null };
export type TrashFolder = Folder & { readonly purgesAt: string | null };

export interface TrashListProps {
  readonly documents: readonly TrashDocument[];
  readonly folders: readonly TrashFolder[];
  readonly clientName?: (clientId: string | null) => string;
  readonly onRestored: () => void;
}

/** Whole days until purge, floored at 0. */
function daysUntil(purgesAt: string | null): number | null {
  if (purgesAt === null) return null;
  const ms = new Date(purgesAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function TrashList({
  documents,
  folders,
  clientName,
  onRestored,
}: TrashListProps): React.JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(kind: 'folder' | 'file', id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const path = kind === 'folder' ? `/api/folders/${id}/restore` : `/api/documents/${id}/restore`;
      await apiClient.post(path);
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore.');
    } finally {
      setBusyId(null);
    }
  }

  if (documents.length === 0 && folders.length === 0) {
    return (
      <EmptyState
        title="Recycle Bin is empty"
        description="Deleted files and folders appear here and stay recoverable until they are purged."
      />
    );
  }

  // Folders first: restoring a folder brings its contents back with it, so it is
  // usually the action a user wants when both are present.
  const rows: readonly {
    kind: 'folder' | 'file';
    id: string;
    name: string;
    clientId: string | null;
    size: number | null;
    deletedAt: string | null;
    purgesAt: string | null;
  }[] = [
    ...folders.map((f) => ({
      kind: 'folder' as const,
      id: f.id,
      name: f.displayName,
      clientId: f.clientId,
      size: null,
      deletedAt: f.deletedAt,
      purgesAt: f.purgesAt,
    })),
    ...documents.map((d) => ({
      kind: 'file' as const,
      id: d.id,
      name: d.fileName,
      clientId: d.clientId,
      size: d.fileSize,
      deletedAt: d.deletedAt,
      purgesAt: d.purgesAt,
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {error !== null ? (
        <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
          {error}
        </span>
      ) : null}
      <Table minWidth="48rem" scrollRegionLabel="Recycle Bin">
        <THead>
          <TH>Name</TH>
          <TH>Client</TH>
          <TH>Deleted</TH>
          <TH>Purges in</TH>
          <TH>Size</TH>
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        </THead>
        <TBody>
          {rows.map((row) => {
            const days = daysUntil(row.purgesAt);
            const urgent = days !== null && days <= 7;
            return (
              <TRow key={`${row.kind}:${row.id}`}>
                <TCell>
                  <span className="flex items-center gap-2">
                    {row.kind === 'folder' ? (
                      <FolderIcon aria-hidden="true" size={16} style={{ color: 'var(--text-secondary)' }} />
                    ) : (
                      <FileText aria-hidden="true" size={16} style={{ color: 'var(--text-secondary)' }} />
                    )}
                    <span style={TYPE.bodyStrong}>{row.name}</span>
                  </span>
                </TCell>
                <TCell>
                  <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
                    {clientName?.(row.clientId) ?? 'Unassigned'}
                  </Badge>
                </TCell>
                <TCell>{row.deletedAt === null ? '—' : formatEasternDate(row.deletedAt)}</TCell>
                <TCell>
                  <span
                    style={{
                      ...TYPE.body,
                      color: urgent ? 'var(--color-red-600)' : 'var(--text-secondary)',
                    }}
                  >
                    {days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}
                  </span>
                </TCell>
                <TCell>
                  <span className="font-data">{row.size === null ? '—' : formatFileSize(row.size)}</span>
                </TCell>
                <TCell>
                  <button
                    type="button"
                    aria-label={`Restore ${row.name}`}
                    onClick={(): void => void restore(row.kind, row.id)}
                    disabled={busyId !== null}
                    className="flex items-center gap-1 rounded-md px-2 py-1"
                    style={{
                      color: 'var(--color-blue-700)',
                      background: 'transparent',
                      cursor: busyId !== null ? 'default' : 'pointer',
                      opacity: busyId !== null ? 0.5 : 1,
                      ...TYPE.secondary,
                    }}
                  >
                    <RotateCcw aria-hidden="true" size={14} />
                    {busyId === row.id ? 'Restoring…' : 'Restore'}
                  </button>
                </TCell>
              </TRow>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
