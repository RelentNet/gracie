'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Nav-collapse context (RL foundation). Shares the main-nav's two orthogonal
 * states so the app-shell header (hamburger) and the {@link Sidebar} stay in sync:
 *
 *  - `collapsed` — the DESKTOP expanded ⇄ icon-rail toggle. Persisted in
 *    localStorage (same pattern as `CollapsibleSection`): render always starts
 *    from the default (SSR-safe) and the saved value is applied after mount.
 *  - `mobileOpen` — the MOBILE off-canvas drawer. Ephemeral (never persisted);
 *    closes on Esc, on scrim click, and on route change (handled by the Sidebar).
 *
 * The two are independent: on mobile the drawer always renders fully expanded
 * regardless of `collapsed`, and on desktop the rail toggle is independent of the
 * drawer (which is hidden at `md`+).
 */

const STORAGE_KEY = 'nav:collapsed';

export interface NavCollapseValue {
  /** Desktop icon-rail state (true = collapsed rail, false = full-width nav). */
  readonly collapsed: boolean;
  /** Flip desktop expanded ⇄ collapsed and persist the choice. */
  toggleCollapsed(): void;
  /** Mobile off-canvas drawer open state. */
  readonly mobileOpen: boolean;
  /** Open the mobile drawer (hamburger). */
  openMobile(): void;
  /** Close the mobile drawer (scrim / Esc / nav select). */
  closeMobile(): void;
}

const NavCollapseContext = createContext<NavCollapseValue | null>(null);

export function NavCollapseProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply the persisted desktop rail state after mount (SSR-safe — server always
  // renders the expanded default, avoiding a hydration mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'collapsed') setCollapsed(true);
      else if (saved === 'expanded') setCollapsed(false);
    } catch {
      // localStorage unavailable (private mode) — keep the default.
    }
  }, []);

  const toggleCollapsed = useCallback((): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // best-effort persistence only.
      }
      return next;
    });
  }, []);

  const openMobile = useCallback((): void => setMobileOpen(true), []);
  const closeMobile = useCallback((): void => setMobileOpen(false), []);

  // Esc closes the mobile drawer (the drawer traps nothing else).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const value = useMemo<NavCollapseValue>(
    () => ({ collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile }),
    [collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile],
  );

  return <NavCollapseContext.Provider value={value}>{children}</NavCollapseContext.Provider>;
}

export function useNavCollapse(): NavCollapseValue {
  const ctx = useContext(NavCollapseContext);
  if (ctx === null) {
    throw new Error('useNavCollapse must be used within a <NavCollapseProvider>.');
  }
  return ctx;
}
