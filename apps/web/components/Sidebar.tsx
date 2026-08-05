'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';

import { ROLE_BADGES } from '@gracie/shared';

import { useAuth } from '@/lib/auth';
import { NAV_GROUPS } from '@/lib/navigation';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { useNavCollapse } from '@/components/ui/nav-collapse';

/**
 * Sidebar (docs/08 §6) — the primary nav. Frosted-glass surface over the tinted
 * ground (theme-aware, light + dark), role-filtered items (Settings hidden for
 * non-admins), brand-soft active highlighting, and a bottom user section
 * (avatar/role/calendar dot/Sign Out).
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
  const { user, can, brandLogoKey, brandLogoDarkKey } = useAuth();
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, mobileOpen, closeMobile } = useNavCollapse();

  // Filter each group's items by role, then drop groups left empty — this hides a
  // section header (CLIENTS/PLANNING/LIBRARY) when all its items are gated away for
  // the current role, so no orphan header renders over nothing.
  const visibleGroups = NAV_GROUPS.map((group) => ({
    header: group.header,
    items: group.items.filter((item) => item.requires === undefined || can(item.requires)),
  })).filter((group) => group.items.length > 0);

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
        style={{
          background: 'var(--surface)',
          WebkitBackdropFilter: 'var(--blur)',
          backdropFilter: 'var(--blur)',
          borderRight: '1px solid var(--hair)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Desktop-only rail toggle, on the sidebar's right edge. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute right-0 top-6 z-10 hidden size-6 translate-x-1/2 items-center justify-center rounded-full border shadow-sm transition-colors md:flex"
          style={{
            backgroundColor: 'var(--surface-2)',
            WebkitBackdropFilter: 'var(--blur)',
            backdropFilter: 'var(--blur)',
            borderColor: 'var(--hair)',
            color: 'var(--text-secondary)',
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
              aria-label="GA App — dashboard"
              className={`flex-1 px-3 py-2 ${collapsed ? 'md:flex md:justify-center md:px-0' : ''}`}
              style={{ ...TYPE.sectionHeader, color: 'var(--text-primary)' }}
            >
              {brandLogoKey !== null ? (
                // Configured brand logo (Settings → Company → Branding). Rendered
                // ONLY as <img src> — never inlined — so an uploaded SVG loads in
                // the browser's secure static mode (can't execute script). The
                // ?v=<key> busts the cache when the logo is replaced. Constrained
                // height, aspect preserved; a wide wordmark shrinks in the rail.
                //
                // With an optional dark-theme logo set, both variants render and
                // the theme-conditional `.logo-light`/`.logo-dark` CSS shows the
                // right one — correct before hydration, no flash (theme.css). No
                // dark logo → a single untagged <img>, unchanged single-logo case.
                brandLogoDarkKey !== null ? (
                  <>
                    <img
                      src={`/api/brand/logo?v=${encodeURIComponent(brandLogoKey)}`}
                      alt="GA App"
                      className="logo-light max-w-full object-contain"
                      style={{ height: '2rem', width: 'auto' }}
                    />
                    <img
                      src={`/api/brand/logo?variant=dark&v=${encodeURIComponent(brandLogoDarkKey)}`}
                      alt="GA App"
                      className="logo-dark max-w-full object-contain"
                      style={{ height: '2rem', width: 'auto' }}
                    />
                  </>
                ) : (
                  <img
                    src={`/api/brand/logo?v=${encodeURIComponent(brandLogoKey)}`}
                    alt="GA App"
                    className="max-w-full object-contain"
                    style={{ height: '2rem', width: 'auto' }}
                  />
                )
              ) : (
                <>
                  <span className={labelHidden}>GA App</span>
                  <span className={`hidden ${collapsed ? 'md:inline' : ''}`}>GA</span>
                </>
              )}
            </Link>
            {/* Mobile-only close button. */}
            <button
              type="button"
              onClick={closeMobile}
              aria-label="Close navigation menu"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg md:hidden"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>

          <div className="flex flex-col">
            {visibleGroups.map((group, groupIndex) => (
              <div
                key={group.header ?? `group-${groupIndex}`}
                // Groups after the first get a thin rule + top spacing. The rule
                // stays in the collapsed rail (only the header text hides), so
                // icons remain grouped by separators.
                className={groupIndex > 0 ? 'mt-2 border-t pt-2' : ''}
                style={groupIndex > 0 ? { borderColor: 'var(--hair)' } : undefined}
              >
                {group.header ? (
                  <div
                    // Muted small-caps section header; hidden in the collapsed rail.
                    className={`px-3 pb-1 ${labelHidden}`}
                    style={{ ...TYPE.label, color: 'var(--text-3)' }}
                  >
                    {group.header}
                  </div>
                ) : null}
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const { Icon } = item;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          // Native tooltip surfaces the label in the collapsed icon rail.
                          title={collapsed ? item.label : undefined}
                          // External targets (e.g. a raw-HTML route handler) open in a
                          // new tab and skip prefetch/RSC navigation, which would break
                          // on a non-page route.
                          target={item.external ? '_blank' : undefined}
                          rel={item.external ? 'noopener noreferrer' : undefined}
                          prefetch={item.external ? false : undefined}
                          aria-current={isActive ? 'page' : undefined}
                          className={`nav-item flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${linkJustify}`}
                          style={{
                            // Inactive items leave bg unset so the `.nav-item:hover`
                            // rule (theme.css) can supply the brand-soft highlight.
                            backgroundColor: isActive ? 'var(--brand-soft)' : undefined,
                            color: isActive ? 'var(--brand-ink)' : 'var(--text-secondary)',
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
            ))}
          </div>
        </div>

        <div
          className={`flex flex-col gap-3 rounded-lg border p-3 ${collapsed ? 'md:p-2' : ''}`}
          style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--hair)' }}
        >
          <div className={`flex items-center gap-3 ${collapsed ? 'md:justify-center' : ''}`}>
            <ClientAvatar initials={user.initials} size="md" color="var(--color-blue-600)" />
            <div className={`flex min-w-0 flex-col ${labelHidden}`}>
              <span className="truncate" style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
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
                  <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
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
                  <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                    {user.isCalendarConnected ? 'Calendar' : 'Offline'}
                  </span>
                </span>
              </span>
            </div>
          </div>
          {/* Full-page nav to the Logto sign-out GET route (clears the session and
              redirects) — a plain <a>, not <Link>, so it never RSC-navigates. */}
          <a
            href="/sign-out"
            title={collapsed ? 'Sign Out' : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${linkJustify}`}
            style={{ color: 'var(--text-secondary)', ...TYPE.bodyStrong }}
          >
            <LogOut aria-hidden="true" size={16} className="shrink-0" />
            <span className={labelHidden}>Sign Out</span>
          </a>
        </div>
      </nav>
    </>
  );
}
