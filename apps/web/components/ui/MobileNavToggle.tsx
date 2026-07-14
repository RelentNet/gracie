'use client';

import { Menu } from 'lucide-react';

import { useNavCollapse } from '@/components/ui/nav-collapse';

/**
 * MobileNavToggle (RL foundation) — the hamburger that opens the off-canvas nav
 * drawer. Lives in the app-shell header and is hidden from `md` up (where the
 * sidebar is always visible). Shares open/closed state with the {@link Sidebar}
 * via the nav-collapse context.
 */
export function MobileNavToggle(): React.JSX.Element {
  const { openMobile, mobileOpen } = useNavCollapse();

  return (
    <button
      type="button"
      onClick={openMobile}
      aria-label="Open navigation menu"
      aria-expanded={mobileOpen}
      aria-controls="primary-nav"
      className="flex size-9 items-center justify-center rounded-lg transition-colors md:hidden"
      style={{ color: 'var(--text-secondary)' }}
    >
      <Menu aria-hidden="true" size={22} />
    </button>
  );
}
