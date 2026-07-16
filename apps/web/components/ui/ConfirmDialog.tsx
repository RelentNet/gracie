'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * ConfirmDialog — a small confirm/cancel dialog over {@link Modal} for
 * irreversible actions (e.g. deleting a Gracie Files file or folder). Awaits the
 * async `onConfirm`, showing a busy label and surfacing any error inline; the
 * dialog closes only on success.
 */
export interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: ReactNode;
  readonly confirmLabel?: string;
  readonly busyLabel?: string;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting…',
  onConfirm,
  onClose,
}: ConfirmDialogProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setError(null);
    onClose();
  }

  async function confirm(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      setSubmitting(false);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={(): void => void confirm()} disabled={submitting}>
            {submitting ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div style={{ ...TYPE.body, color: 'var(--text-primary)' }}>{message}</div>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
