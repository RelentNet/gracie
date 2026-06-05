import type { CSSProperties } from 'react';

import type { BadgeStatus } from '@gracie/shared';

/**
 * StatusBadge (docs/08 §5). Status conveyed by icon + TEXT, not color alone
 * (docs/08 §11). Color mapping is exact per the spec table.
 */

export type StatusBadgeSize = 'sm' | 'md' | 'lg';

interface StatusStyle {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
}

const STATUS_STYLES: Readonly<Record<BadgeStatus, StatusStyle>> = {
  scheduled: { label: 'Scheduled', bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)' },
  processing: { label: 'Processing', bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  complete: { label: 'Complete', bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)' },
  'needs-review': {
    label: 'Needs Review',
    bg: 'var(--color-amber-100)',
    fg: 'var(--color-amber-600)',
  },
  overdue: { label: 'Overdue', bg: 'var(--color-red-100)', fg: 'var(--color-red-600)' },
};

const SIZE_STYLES: Readonly<Record<StatusBadgeSize, CSSProperties>> = {
  sm: { fontSize: '0.6875rem', padding: '0.0625rem 0.375rem' },
  md: { fontSize: '0.75rem', padding: '0.125rem 0.5rem' },
  lg: { fontSize: '0.8125rem', padding: '0.25rem 0.625rem' },
};

export interface StatusBadgeProps {
  readonly status: BadgeStatus;
  readonly size?: StatusBadgeSize;
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps): React.JSX.Element {
  const style = STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md font-medium"
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        fontWeight: 600,
        ...SIZE_STYLES[size],
      }}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: style.fg }} />
      {style.label}
    </span>
  );
}
