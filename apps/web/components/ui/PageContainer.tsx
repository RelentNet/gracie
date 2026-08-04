import type { ReactNode } from 'react';

/**
 * PageContainer (RL foundation) — a consistent max-width + horizontal-centering
 * wrapper for page content. Page PADDING is owned solely by the app shell's
 * `<main>` (see app/(app)/layout.tsx); this wrapper deliberately adds none, so a
 * page nested in `<main>` is never double-padded.
 *
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
    <div className={`mx-auto w-full min-w-0 ${MAX_WIDTH[width]} ${className}`}>{children}</div>
  );
}
