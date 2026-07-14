'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media-query hooks (RL foundation). Pass-2 pages use these to make
 * JS-driven layout decisions (e.g. render a card grid vs. a table) that CSS
 * breakpoints alone can't express.
 *
 * SSR safety: the server (and the first client render) always returns
 * `defaultValue`, then the real match is applied after mount — so there is no
 * hydration mismatch. Default to the mobile-first value (`false`) so the initial
 * paint matches a small viewport; components that must not flash on desktop should
 * prefer CSS `md:` utilities for structure and use these hooks only for behaviour.
 */

/** Tailwind's default min-width breakpoints (px), exposed for JS parity with CSS. */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** True when `query` currently matches. SSR-safe (see module docs). */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const update = (): void => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * True when the viewport is at least `bp` wide (a `min-width` query), matching the
 * Tailwind `md:`/`lg:`/… semantics. Defaults to `false` (mobile-first) for SSR.
 */
export function useBreakpoint(bp: Breakpoint, defaultValue = false): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`, defaultValue);
}
