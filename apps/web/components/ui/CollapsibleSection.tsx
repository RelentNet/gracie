'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { TYPE } from '@/lib/typography';

/**
 * CollapsibleSection — a bordered surface whose body folds behind a clickable
 * header (docs/08 §4 card styling). Built for long settings-style pages so each
 * section can be collapsed. Accessible: the header is a real `<button>` with
 * `aria-expanded`/`aria-controls`; the body stays mounted (hidden) so child state
 * and in-flight fetches are preserved across open/close.
 *
 * Pass a stable `storageKey` to remember the open/closed state across reloads
 * (localStorage). Rendering always starts from `defaultOpen` (SSR-safe) and the
 * saved state is applied after mount.
 */
export function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = true,
  storageKey,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  /** Stable key to persist open/closed across reloads; omit for no persistence. */
  readonly storageKey?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  useEffect(() => {
    if (storageKey === undefined) return;
    try {
      const saved = window.localStorage.getItem(`collapsible:${storageKey}`);
      if (saved === 'open') setOpen(true);
      else if (saved === 'closed') setOpen(false);
    } catch {
      // localStorage unavailable (private mode) — fall back to defaultOpen.
    }
  }, [storageKey]);

  const toggle = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey !== undefined) {
        try {
          window.localStorage.setItem(`collapsible:${storageKey}`, next ? 'open' : 'closed');
        } catch {
          // best-effort persistence only.
        }
      }
      return next;
    });
  };

  const contentId = `collapsible-${(storageKey ?? title).replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="rounded-lg border bg-white shadow-sm" style={{ borderColor: 'var(--border-subtle)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
        style={{ cursor: 'pointer' }}
      >
        <span className="flex flex-col gap-1">
          <span style={TYPE.sectionHeader}>{title}</span>
          {description !== undefined ? (
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{description}</span>
          ) : null}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="shrink-0"
          style={{
            transition: 'transform 150ms ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            color: 'var(--text-secondary)',
          }}
        />
      </button>
      <div
        id={contentId}
        hidden={!open}
        className="border-t p-4"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {children}
      </div>
    </div>
  );
}
