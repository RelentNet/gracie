'use client';

import { useState } from 'react';
import type { Folder } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * New-folder modal (docs/08 §8; p2fix §3). Editors create a subfolder under the
 * selected folder (or the client root); Admins may mark it restricted (Admin-only
 * visibility, docs/02 §D14). POSTs to `/api/folders`.
 */
export interface NewFolderModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (folder: Folder) => void;
  /** Owning client — ignored in the `'staff'` variant (server resolves the org). */
  readonly clientId: string | null;
  readonly parentFolderId: string | null;
  readonly parentLabel: string;
  readonly isAdmin: boolean;
  /**
   * `'client'` (default) posts to `/api/folders` with `clientId`. `'staff'` posts to
   * `/api/staff/folders` (Gracie Files) — no client, `kind='staff'`, `staff/` root.
   */
  readonly variant?: 'client' | 'staff';
}

interface CreateFolderResponse {
  readonly folder: Folder;
}

export function NewFolderModal({
  isOpen,
  onClose,
  onCreated,
  clientId,
  parentFolderId,
  parentLabel,
  isAdmin,
  variant = 'client',
}: NewFolderModalProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setName('');
    setRestricted(false);
    setError(null);
    onClose();
  }

  async function submit(): Promise<void> {
    if (name.trim() === '') {
      setError('Folder name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = variant === 'staff' ? '/api/staff/folders' : '/api/folders';
      const payload =
        variant === 'staff'
          ? { parentFolderId, name: name.trim(), restricted }
          : { clientId, parentFolderId, name: name.trim(), restricted };
      const { folder } = await apiClient.post<CreateFolderResponse>(endpoint, payload);
      onCreated(folder);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create folder.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="New folder"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={(): void => void submit()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create folder'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Creating in <strong>{parentLabel}</strong>.
        </p>
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Folder name *</span>
          <input
            className="w-full rounded-lg border bg-white px-3 py-2"
            style={inputStyle}
            value={name}
            onChange={(event): void => setName(event.target.value)}
            placeholder="e.g. Contract Documents"
          />
        </label>
        {isAdmin ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={restricted}
              onChange={(event): void => setRestricted(event.target.checked)}
            />
            <span style={TYPE.body}>Restrict to admins (hidden from other roles)</span>
          </label>
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
