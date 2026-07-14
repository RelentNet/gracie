import type { ReactNode } from 'react';

/**
 * PageContainer (RL foundation) — a consistent max-width + responsive-padding
 * wrapper for page content. It is intentionally NOT wired into any page yet; the
 * pass-2 responsive sweep drops it into each page's root so padding and max-width
 * are uniform (and shrink correctly on mobile) everywhere.
 *
 * Padding scales with the viewport (tight on mobile, roomier on desktop) and
 * `min-w-0` lets wide children (tables, code) shrink/scroll inside their own
 * container instead of forcing the shell to scroll horizontally.
 */

/** Max content width. `'full'` opts out of the max-width cap (edge-to-edge). */
export type PageContainerWidth = 'md' | 'lg' | 'xl' | '2xl' | 'full';

const MAX_WIDTH: Readonly<Record<PageContainerWidth, string>> = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
  '2xl': 'max-w-screen-2xl',
  full: 'max-w-full',
};

export function PageContainer({
  children,
  width = 'xl',
  className = '',
}: {
  readonly children: ReactNode;
  /** Max content width (default `xl`). */
  readonly width?: PageContainerWidth;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`mx-auto w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 ${MAX_WIDTH[width]} ${className}`}
    >
      {children}
    </div>
  );
}
