'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { ROLE_BADGES } from '@gracie/shared';

import { useAuth } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/navigation';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';

/**
 * Sidebar (docs/08 §6). Navy background, 9 nav items (role-filtered — Settings
 * hidden for non-admin), and a bottom user section: avatar initials, name, role
 * badge, calendar connection dot, Sign Out.
 *
 * Role filtering reads the MOCK user from `useAuth` (Phase 1A). The same logic
 * works unchanged against the real Logto session in Phase 1B.
 */
export function Sidebar(): React.JSX.Element {
  const { user, can } = useAuth();
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.requires === undefined || can(item.requires),
  );

  const roleBadge = ROLE_BADGES[user.role];

  return (
    <nav
      aria-label="Primary"
      className="flex h-dvh w-60 shrink-0 flex-col justify-between p-3"
      style={{ backgroundColor: 'var(--color-navy-900)', color: '#ffffff' }}
    >
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard"
          className="mb-3 px-3 py-2"
          style={{ ...TYPE.sectionHeader, color: '#ffffff' }}
        >
          GA App
        </Link>
        <ul className="flex flex-col gap-0.5">
          {visibleItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const { Icon } = item;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  // External targets (e.g. /roadmap, a raw-HTML route handler) open
                  // in a new tab and skip prefetch/RSC navigation, which would break
                  // on a non-page route.
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  prefetch={item.external ? false : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--color-navy-800)' : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--color-slate-100)',
                    ...TYPE.bodyStrong,
                  }}
                >
                  <Icon aria-hidden="true" size={18} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className="flex flex-col gap-3 rounded-lg p-3"
        style={{ backgroundColor: 'var(--color-navy-800)' }}
      >
        <div className="flex items-center gap-3">
          <ClientAvatar initials={user.initials} size="md" color="var(--color-blue-700)" />
          <div className="flex min-w-0 flex-col">
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
          className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
          style={{ color: 'var(--color-slate-100)', ...TYPE.bodyStrong }}
        >
          <LogOut aria-hidden="true" size={16} />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
