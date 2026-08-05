import type { CSSProperties } from 'react';

/**
 * ClientAvatar (docs/08 §5). Circular avatar showing client initials. Defaults
 * to a navy background; an explicit `color` token may override it.
 *
 * When `logoSrc` is set (a client with an uploaded logo), the logo renders
 * instead of the initials — a same-size square with the whole logo shown
 * (`object-contain`, aspect preserved, rounded, on white so transparent PNG/SVG
 * reads). Rendered ONLY via `<img>` so an uploaded SVG loads in secure static
 * mode. Person/user avatars pass no `logoSrc` and keep the initials.
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
  /** When set, render this logo image instead of the initials. */
  readonly logoSrc?: string | null;
}

export function ClientAvatar({
  initials,
  size = 'md',
  color = 'var(--color-navy-800)',
  logoSrc = null,
}: ClientAvatarProps): React.JSX.Element {
  const dimension = SIZE_PX[size];

  if (logoSrc !== null && logoSrc !== '') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg"
        style={{
          width: dimension,
          height: dimension,
          backgroundColor: '#ffffff',
          border: '1px solid var(--border-subtle)',
        }}
        aria-hidden="true"
      >
        {/* <img> only — an uploaded SVG loads in the browser's secure static mode. */}
        <img
          src={logoSrc}
          alt=""
          className="h-full w-full object-contain"
          style={{ padding: 2 }}
        />
      </span>
    );
  }

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
