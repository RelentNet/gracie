import type { ReactNode } from 'react';

/**
 * Badge — generic colored pill primitive (docs/08 §4/§5). Distinct from the
 * domain-specific `StatusBadge`/`DocumentPill`: this is the low-level building
 * block the client-display helpers feed (priority, file status, source type).
 * Color is supplemented by text so meaning is never color-only (docs/08 §11).
 */
export interface BadgeProps {
  readonly children: ReactNode;
  readonly bg: string;
  readonly fg: string;
  /** Optional leading icon element. */
  readonly icon?: ReactNode;
}

export function Badge({ children, bg, fg, icon }: BadgeProps): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md"
      style={{
        backgroundColor: bg,
        color: fg,
        fontSize: '0.6875rem',
        fontWeight: 600,
        padding: '0.0625rem 0.375rem',
        letterSpacing: '0.02em',
      }}
    >
      {icon}
      {children}
    </span>
  );
}
