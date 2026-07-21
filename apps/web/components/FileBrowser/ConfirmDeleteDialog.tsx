'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Confirm moving a folder or file to the recycle bin.
 *
 * Deliberately not `window.confirm`: a folder delete is recursive, and the user needs
 * to see HOW MUCH it takes with it before agreeing. It also says plainly that this is
 * recoverable — the common failure mode with a trash feature is users assuming Delete
 * is permanent and never using it.
 */
export interface DeleteTarget {
  readonly kind: 'folder' | 'file';
  readonly id: string;
  readonly name: string;
  /** Folders: how many live documents sit inside (including subfolders). */
  readonly documentCount?: number;
  readonly folderCount?: number;
}

export interface ConfirmDeleteDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
  readonly target: DeleteTarget;
  readonly retentionDays: number;
}

/** "This folder, 2 subfolders and 12 files" / "This file". */
function describeScope(target: DeleteTarget): string {
  if (target.kind === 'file') return 'This file';
  const parts: string[] = ['This folder'];
  const subfolders = (target.folderCount ?? 1) - 1;
  if (subfolders > 0) parts.push(`${subfolders} subfolder${subfolders === 1 ? '' : 's'}`);
  const docs = target.documentCount ?? 0;
  if (docs > 0) parts.push(`${docs} file${docs === 1 ? '' : 's'}`);
  if (parts.length === 1) return 'This folder (empty)';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function ConfirmDeleteDialog({
  isOpen,
  onClose,
  onDeleted,
  target,
  retentionDays,
}: ConfirmDeleteDialogProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const path =
        target.kind === 'folder' ? `/api/folders/${target.id}` : `/api/documents/${target.id}`;
      await apiClient.del(path);
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={target.kind === 'folder' ? 'Delete folder?' : 'Delete file?'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={(): void => void submit()} disabled={submitting}>
            {submitting ? 'Deleting…' : 'Move to Recycle Bin'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            size={20}
            style={{ color: 'var(--color-amber-500)', flexShrink: 0, marginTop: 2 }}
          />
          <div className="flex flex-col gap-2">
            <p style={TYPE.body}>
              <strong>{target.name}</strong>
            </p>
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              {describeScope(target)} will move to the Recycle Bin.
            </p>
          </div>
        </div>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          It stays recoverable for {retentionDays} days. While it is in the bin it cannot be viewed
          or downloaded — you have to restore it first.
        </p>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
