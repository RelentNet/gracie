import type { ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Reusable loading / error / empty state blocks. Every data-backed view must
 * render one of these while it has no real content (global standard + docs/08
 * §5). In Phase 1A pages are not yet wired to data, so they render `EmptyState`
 * with a contextual message (no Lorem ipsum).
 */

interface StateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

function StateShell({
  title,
  description,
  action,
  tone,
}: StateProps & { readonly tone: 'neutral' | 'error' }): React.JSX.Element {
  const borderColor = tone === 'error' ? 'var(--color-red-500)' : 'var(--border-subtle)';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex flex-col items-start gap-2 rounded-lg border bg-white p-6"
      style={{ borderColor }}
    >
      <p style={TYPE.bodyStrong}>{title}</p>
      {description !== undefined ? (
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{description}</p>
      ) : null}
      {action}
    </div>
  );
}

/** Loading placeholder — shown while a request is in flight. */
export function LoadingState({ label = 'Loading…' }: { readonly label?: string }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border bg-white p-6"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2"
        style={{ borderColor: 'var(--color-slate-100)', borderTopColor: 'var(--color-blue-500)' }}
      />
      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

/** Error block — shown when a request fails. */
export function ErrorState(props: StateProps): React.JSX.Element {
  return <StateShell {...props} tone="error" />;
}

/** Empty block — shown when a request succeeds but returns no rows. */
export function EmptyState(props: StateProps): React.JSX.Element {
  return <StateShell {...props} tone="neutral" />;
}
