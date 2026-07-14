'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';

import { ROLE_BADGES } from '@gracie/shared';

import { useAuth } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/navigation';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { useNavCollapse } from '@/components/ui/nav-collapse';

/**
 * Sidebar (docs/08 §6) — the primary nav. Navy background, role-filtered items
 * (Settings hidden for non-admins), active highlighting, and a bottom user
 * section (avatar/role/calendar dot/Sign Out).
 *
 * RL responsive foundation — three states, sharing {@link useNavCollapse}:
 *  - **Expanded** (`w-60`) — default on `md`+ screens.
 *  - **Collapsed rail** (`md:w-16`) — desktop icon-only; labels/details hidden
 *    (`md:hidden`), icons centered, native tooltips on the links. A toggle on the
 *    sidebar's right edge flips it; the choice persists in localStorage.
 *  - **Mobile drawer** (below `md`) — off-canvas, slides in over a scrim; opened
 *    by the header hamburger, closed by the scrim, the ✕, Esc, or route change.
 *    Always renders fully expanded regardless of the desktop collapsed state.
 */
export function Sidebar(): React.JSX.Element {
  const { user, can } = useAuth();
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, mobileOpen, closeMobile } = useNavCollapse();

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.requires === undefined || can(item.requires),
  );

  const roleBadge = ROLE_BADGES[user.role];

  // Close the mobile drawer on route change — covers "selecting a nav item".
  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  // Collapsed-rail helpers. These `md:` utilities are inert below `md`, so the
  // mobile drawer always renders fully expanded even when `collapsed` is true.
  const labelHidden = collapsed ? 'md:hidden' : '';
  const linkJustify = collapsed ? 'md:justify-center' : '';

  return (
    <>
      {/* Scrim — mobile only; click closes the drawer. */}
      <div
        aria-hidden="true"
        onClick={closeMobile}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <nav
        id="primary-nav"
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-60 shrink-0 flex-col justify-between p-3 transition-[transform,width] duration-200 ease-in-out md:relative md:z-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-16' : 'md:w-60'}`}
        style={{ backgroundColor: 'var(--color-navy-900)', color: '#ffffff' }}
      >
        {/* Desktop-only rail toggle, on the sidebar's right edge. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute right-0 top-6 z-10 hidden size-6 translate-x-1/2 items-center justify-center rounded-full border shadow-sm transition-colors md:flex"
          style={{
            backgroundColor: 'var(--color-navy-800)',
            borderColor: 'var(--color-navy-700)',
            color: '#ffffff',
          }}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" size={14} />
          ) : (
            <ChevronLeft aria-hidden="true" size={14} />
          )}
        </button>

        <div className="flex flex-col gap-1">
          <div className="mb-3 flex items-center gap-2">
            <Link
              href="/dashboard"
              className={`flex-1 px-3 py-2 ${collapsed ? 'md:px-0 md:text-center' : ''}`}
              style={{ ...TYPE.sectionHeader, color: '#ffffff' }}
            >
              <span className={labelHidden}>GA App</span>
              <span className={`hidden ${collapsed ? 'md:inline' : ''}`}>GA</span>
            </Link>
            {/* Mobile-only close button. */}
            <button
              type="button"
              onClick={closeMobile}
              aria-label="Close navigation menu"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg md:hidden"
              style={{ color: 'var(--color-slate-100)' }}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>

          <ul className="flex flex-col gap-0.5">
            {visibleItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const { Icon } = item;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // Native tooltip surfaces the label in the collapsed icon rail.
                    title={collapsed ? item.label : undefined}
                    // External targets (e.g. /roadmap, a raw-HTML route handler) open
                    // in a new tab and skip prefetch/RSC navigation, which would break
                    // on a non-page route.
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noopener noreferrer' : undefined}
                    prefetch={item.external ? false : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${linkJustify}`}
                    style={{
                      backgroundColor: isActive ? 'var(--color-navy-800)' : 'transparent',
                      color: isActive ? '#ffffff' : 'var(--color-slate-100)',
                      ...TYPE.bodyStrong,
                    }}
                  >
                    <Icon aria-hidden="true" size={18} className="shrink-0" />
                    <span className={labelHidden}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div
          className={`flex flex-col gap-3 rounded-lg p-3 ${collapsed ? 'md:p-2' : ''}`}
          style={{ backgroundColor: 'var(--color-navy-800)' }}
        >
          <div className={`flex items-center gap-3 ${collapsed ? 'md:justify-center' : ''}`}>
            <ClientAvatar initials={user.initials} size="md" color="var(--color-blue-700)" />
            <div className={`flex min-w-0 flex-col ${labelHidden}`}>
              <span className="truncate" style={{ ...TYPE.bodyStrong, color: '#ffffff' }}>
                {user.name}
              </span>
              <span className="flex items-center gap-2">
                {roleBadge.token !== null ? (
                  <span
                    className="rounded-md"
                    style={{
                      backgroundColor: `var(${roleBadge.token})`,
                      color: '#ffffff',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '0.0625rem 0.375rem',
                    }}
                  >
                    {roleBadge.label}
                  </span>
                ) : (
                  <span style={{ ...TYPE.secondary, color: 'var(--color-slate-100)' }}>
                    {roleBadge.label}
                  </span>
                )}
                <span className="inline-flex items-center gap-1" title="Calendar connection">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: user.isCalendarConnected
                        ? 'var(--color-emerald-500)'
                        : 'var(--color-slate-500)',
                    }}
                  />
                  <span style={{ ...TYPE.secondary, color: 'var(--color-slate-100)' }}>
                    {user.isCalendarConnected ? 'Calendar' : 'Offline'}
                  </span>
                </span>
              </span>
            </div>
          </div>
          {/* Phase 1B: wire Sign Out to the Logto sign-out endpoint. */}
          <button
            type="button"
            title={collapsed ? 'Sign Out' : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${linkJustify}`}
            style={{ color: 'var(--color-slate-100)', ...TYPE.bodyStrong }}
          >
            <LogOut aria-hidden="true" size={16} className="shrink-0" />
            <span className={labelHidden}>Sign Out</span>
          </button>
        </div>
      </nav>
    </>
  );
}
