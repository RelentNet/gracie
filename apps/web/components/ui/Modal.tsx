'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Modal — generic dialog primitive (docs/08 §4: `shadow-xl`). Renders a dimmed
 * overlay + centered panel, closes on Escape and overlay click, and traps the
 * heading via `aria-labelledby` (docs/08 §11). Controlled via `isOpen`. Reused
 * by upload / new-folder dialogs and the later Task Board.
 */
export interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Optional footer slot (actions). */
  readonly footer?: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
}: ModalProps): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return (): void => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const titleId = 'modal-title';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
        onClick={(event): void => event.stopPropagation()}
      >
        <header
          className="flex items-center justify-between gap-4 border-b p-4"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <h2 id={titleId} style={TYPE.sectionHeader}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1"
            style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="p-6">{children}</div>
        {footer !== undefined ? (
          <footer
            className="flex justify-end gap-2 border-t p-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
