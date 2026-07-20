'use client';

import { useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Rename a folder or a file.
 *
 * Renaming is metadata-only on both sides — `folders.display_name` and
 * `documents.file_name` are separate columns from `folders.path` / `documents.r2_key`.
 * Nothing moves in storage, so this is safe on a folder with thousands of objects
 * beneath it.
 */
export interface RenameModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRenamed: () => void;
  readonly target: { readonly kind: 'folder' | 'file'; readonly id: string; readonly name: string };
}

export function RenameModal({
  isOpen,
  onClose,
  onRenamed,
  target,
}: RenameModalProps): React.JSX.Element {
  const [name, setName] = useState(target.name);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFolder = target.kind === 'folder';
  const trimmed = name.trim();
  const unchanged = trimmed === target.name;

  async function submit(): Promise<void> {
    if (trimmed === '') {
      setError('A name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const path = isFolder ? `/api/folders/${target.id}` : `/api/documents/${target.id}`;
      await apiClient.patch(path, isFolder ? { displayName: trimmed } : { fileName: trimmed });
      onRenamed();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isFolder ? 'Rename folder' : 'Rename file'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={(): void => void submit()}
            disabled={submitting || trimmed === '' || unchanged}
          >
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            {isFolder ? 'Folder name' : 'File name'} *
          </span>
          <input
            className="w-full rounded-lg border bg-white px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
            value={name}
            autoFocus
            onChange={(event): void => setName(event.target.value)}
            onKeyDown={(event): void => {
              if (event.key === 'Enter' && trimmed !== '' && !unchanged) void submit();
            }}
          />
        </label>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Only the display name changes — the stored file{isFolder ? 's stay' : ' stays'} exactly
          where {isFolder ? 'they are' : 'it is'}.
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
