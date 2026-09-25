import { Outlet } from 'react-router';

import { NotificationBell } from '@/components/NotificationBell';
import { SessionWatcher } from '@/components/SessionWatcher';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { VersionBadge } from '@/components/VersionBadge';
import { TimezoneAutoDefault } from '@/components/TimezoneAutoDefault';
import { MobileNavToggle } from '@/components/ui/MobileNavToggle';
import { NavCollapseProvider } from '@/components/ui/nav-collapse';

/**
 * Authenticated app shell (docs/03 §3). Sidebar + main content region. Role
 * filtering for nav lives in the Sidebar; the same role data gates page-level
 * content. Signed-out visitors never get here: the app root (src/main.tsx) sends
 * them to /login when the bootstrap request is refused.
 */
export default function AppLayout(): React.JSX.Element {
  return (
    // Fixed-height shell: `<main>` is the single vertical scroll container so the
    // header (and sidebar) stay put, and `overflow-hidden` guarantees no
    // horizontal body scroll at any width. The sidebar is static on `md`+ and an
    // off-canvas drawer below it (both driven by the shared nav-collapse context).
    <NavCollapseProvider>
      {/* Silently defaults the user's profile timezone from the browser on first
          load if unset; renders nothing. */}
      <TimezoneAutoDefault />
      {/* Detects a stale sign-in and prompts a clean re-login instead of letting
          actions silently fail. Without Logto its probe always succeeds, so it
          never prompts. */}
      <SessionWatcher />
      <div className="flex h-dvh overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="glass flex h-14 shrink-0 items-center gap-1 border-b px-4 sm:px-6 md:px-8"
            style={{ borderColor: 'var(--hair)', borderRadius: 0, boxShadow: 'none' }}
          >
            <MobileNavToggle />
            <div className="flex-1" />
            {/* Running version → What's New (dot until the latest release is seen). */}
            <VersionBadge />
            <ThemeToggle />
            <NotificationBell />
          </header>
          {/* Sole owner of page padding (PageContainer adds none, so no doubling).
              Top is kept tighter than the sides/bottom on purpose. */}
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6 md:px-8 md:pb-8 md:pt-6">
            <Outlet />
          </main>
        </div>
      </div>
    </NavCollapseProvider>
  );
}
