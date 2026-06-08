import type { CSSProperties, ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Card — generic surface primitive (docs/08 §4: `rounded-lg`, `shadow-sm`,
 * `p-6`). Reused across the client profile, file browser, and (later) the Task
 * Board. An `accent` prop draws a colored left border for admin-only/critical
 * surfaces (docs/08 §1).
 */
export type CardAccent = 'none' | 'admin' | 'critical';

const ACCENT_BORDER: Readonly<Record<CardAccent, string | undefined>> = {
  none: undefined,
  admin: 'var(--color-red-500)',
  critical: 'var(--color-red-500)',
};

export interface CardProps {
  readonly children: ReactNode;
  /** Colored left border for admin-only / critical surfaces. */
  readonly accent?: CardAccent;
  /** Tailwind padding override; defaults to compact card padding. */
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Card({
  children,
  accent = 'none',
  className = 'p-6',
  style,
}: CardProps): React.JSX.Element {
  const accentBorder = ACCENT_BORDER[accent];
  return (
    <div
      className={`rounded-lg border bg-white shadow-sm ${className}`}
      style={{
        borderColor: 'var(--border-subtle)',
        borderLeft: accentBorder !== undefined ? `3px solid ${accentBorder}` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  readonly title: string;
  readonly description?: string;
  /** Optional right-aligned slot (actions, badges). */
  readonly action?: ReactNode;
  /** Optional leading icon/element. */
  readonly icon?: ReactNode;
}

/** Standard card header: title + optional description and right-aligned action. */
export function CardHeader({
  title,
  description,
  action,
  icon,
}: CardHeaderProps): React.JSX.Element {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-2">
        {icon}
        <div className="flex flex-col gap-1">
          <h2 style={TYPE.sectionHeader}>{title}</h2>
          {description !== undefined ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{description}</p>
          ) : null}
        </div>
      </div>
      {action}
    </header>
  );
}
