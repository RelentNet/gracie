import type { ReactNode } from 'react';

import { TYPE } from '@/lib/typography';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * Standard page scaffold for Phase 1A module pages: a titled header plus a
 * contextual empty state. Each module page passes a real, descriptive message
 * (no Lorem ipsum). When a module is wired to data in a later phase, the
 * `EmptyState` is swapped for the real loading/error/data branches.
 */
export interface PagePlaceholderProps {
  readonly title: string;
  readonly description: string;
  /** The contextual empty-state message describing what will appear here. */
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  /** Optional header-right slot (e.g. an action button placeholder). */
  readonly headerAction?: ReactNode;
}

export function PagePlaceholder({
  title,
  description,
  emptyTitle,
  emptyDescription,
  headerAction,
}: PagePlaceholderProps): React.JSX.Element {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>{title}</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{description}</p>
        </div>
        {headerAction}
      </header>
      <EmptyState title={emptyTitle} description={emptyDescription} />
    </section>
  );
}
