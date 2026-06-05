'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use } from 'react';
import type { ReactNode } from 'react';

import type { Permission } from '@gracie/shared';

import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';

/**
 * Client profile shell with the 7-tab nav (docs/08 §9, docs/03 §3).
 *
 * Tabs: Overview, Strategy, Finance (Admin only), Operations, Notes, Documents,
 * Intelligence. The Finance tab is gated by `finance.view` (D14) and is HIDDEN
 * entirely for non-admin roles — mirroring the server omission, not merely
 * disabled. Role data comes from the MOCK `useAuth` (Phase 1A); the same
 * filtering works unchanged against the real Logto session in Phase 1B.
 *
 * Phase 1B: tabs become renamable/reorderable by Admin (backed by `client_tabs`).
 */
interface ClientTab {
  readonly label: string;
  readonly segment: string;
  /** Permission required to see this tab; undefined = all roles. */
  readonly requires?: Permission;
}

const CLIENT_TABS: readonly ClientTab[] = [
  { label: 'Overview', segment: 'overview' },
  { label: 'Strategy', segment: 'strategy' },
  { label: 'Finance', segment: 'finance', requires: 'finance.view' },
  { label: 'Operations', segment: 'operations' },
  { label: 'Notes', segment: 'notes' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Intelligence', segment: 'intelligence' },
] as const;

export default function ClientDetailLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { can } = useAuth();
  const pathname = usePathname();

  const visibleTabs = CLIENT_TABS.filter(
    (tab) => tab.requires === undefined || can(tab.requires),
  );

  const basePath = `/clients/${clientId}`;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        {/* Phase 1B: replace placeholder initials with the fetched client. */}
        <ClientAvatar initials="CL" size="lg" />
        <div className="flex flex-col gap-0.5">
          <h1 style={TYPE.pageTitle}>Client Profile</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Client reference: {clientId}
          </p>
        </div>
      </header>

      <nav aria-label="Client profile tabs" className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <ul className="flex flex-wrap gap-1">
          {visibleTabs.map((tab) => {
            const href = `${basePath}/${tab.segment}`;
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={tab.segment}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className="inline-block px-4 py-2"
                  style={{
                    ...TYPE.bodyStrong,
                    color: isActive ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                    borderBottom: isActive
                      ? '2px solid var(--color-blue-500)'
                      : '2px solid transparent',
                  }}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </section>
  );
}
