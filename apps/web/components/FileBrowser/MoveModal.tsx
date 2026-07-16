'use client';

import { useState } from 'react';
import type { Document, Folder } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Move/refile modal (docs/08 §8; p2fix §4). Editors relocate a document into
 * another folder of the SAME client. POSTs to `/api/documents/move`, which moves
 * the MinIO object and updates `folder_id`. Destination options exclude the
 * document's current folder; restricted destinations are only present for Admins
 * (the caller passes already-visible folders, docs/02 §D14).
 */
export interface MoveModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onMoved: () => void;
  readonly document: Document | null;
  /** Candidate destination folders (same client, already role-filtered). */
  readonly folders: readonly Folder[];
  /**
   * `'client'` (default) posts to `/api/documents/move`. `'staff'` posts to
   * `/api/staff/move` (Gracie Files).
   */
  readonly variant?: 'client' | 'staff';
}

export function MoveModal({
  isOpen,
  onClose,
  onMoved,
  document,
  folders,
  variant = 'client',
}: MoveModalProps): React.JSX.Element {
  const [destinationFolderId, setDestinationFolderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = folders.filter((folder) => folder.id !== document?.folderId);

  function close(): void {
    setDestinationFolderId('');
    setError(null);
    onClose();
  }

  async function submit(): Promise<void> {
    if (document === null) return;
    if (destinationFolderId === '') {
      setError('Choose a destination folder.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(variant === 'staff' ? '/api/staff/move' : '/api/documents/move', {
        documentId: document.id,
        destinationFolderId,
      });
      onMoved();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move the document.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Move document"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={(): void => void submit()} disabled={submitting}>
            {submitting ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {document !== null ? (
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Moving <strong>{document.fileName}</strong>.
          </p>
        ) : null}
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Destination folder *</span>
          <select
            className="w-full rounded-lg border bg-white px-3 py-2"
            style={inputStyle}
            value={destinationFolderId}
            onChange={(event): void => setDestinationFolderId(event.target.value)}
          >
            <option value="">Select a folder…</option>
            {options.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.displayName}
              </option>
            ))}
          </select>
        </label>
        {options.length === 0 ? (
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            No other folders available for this client. Create one with “New Folder”.
          </span>
        ) : null}
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
