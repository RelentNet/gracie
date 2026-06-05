import type { CSSProperties } from 'react';

/**
 * ClientAvatar (docs/08 §5). Circular avatar showing client initials. Defaults
 * to a navy background; an explicit `color` token may override it.
 */

export type ClientAvatarSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Readonly<Record<ClientAvatarSize, number>> = {
  sm: 28,
  md: 36,
  lg: 48,
};

const FONT_PX: Readonly<Record<ClientAvatarSize, string>> = {
  sm: '0.6875rem',
  md: '0.8125rem',
  lg: '1rem',
};

export interface ClientAvatarProps {
  readonly initials: string;
  readonly size?: ClientAvatarSize;
  /** CSS color value for the background; defaults to navy. */
  readonly color?: string;
}

export function ClientAvatar({
  initials,
  size = 'md',
  color = 'var(--color-navy-800)',
}: ClientAvatarProps): React.JSX.Element {
  const dimension = SIZE_PX[size];
  const style: CSSProperties = {
    width: dimension,
    height: dimension,
    backgroundColor: color,
    color: '#ffffff',
    fontSize: FONT_PX[size],
    fontWeight: 600,
  };
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={style}
      aria-hidden="true"
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}
