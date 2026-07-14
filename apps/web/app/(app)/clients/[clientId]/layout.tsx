'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { ArrowLeft, Upload } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Client, Permission } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Button } from '@/components/ui/Button';
import { PageContainer } from '@/components/ui/PageContainer';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Client profile shell with the 7-tab nav (docs/08 §9, docs/03 §3).
 *
 * Tabs: Overview, Strategy, Finance (Admin only), Operations, Notes, Documents,
 * Intelligence. The Finance tab is gated by `finance.view` (D14) and is HIDDEN
 * entirely for non-admin roles — mirroring the server omission, not merely
 * disabled. The Upload action is hidden for viewers (`file.upload`, D14). Role
 * data comes from the MOCK `useAuth` (Phase 1A); the same filtering works
 * unchanged against the real Logto session in Phase 1B.
 *
 * Phase 1B: tabs become renamable/reorderable by Admin (backed by `client_tabs`);
 * the client header now reads from `GET /api/clients/:id/overview` (real data).
 */
interface OverviewResponse {
  readonly client: Client;
}

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

  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<OverviewResponse>(`/api/clients/${clientId}/overview`)
      .then((data) => {
        if (active) setClient(data.client);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load client');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  const canUpload = can('file.upload');

  const visibleTabs = CLIENT_TABS.filter(
    (tab) => tab.requires === undefined || can(tab.requires),
  );

  const basePath = `/clients/${clientId}`;

  return (
    <PageContainer className="flex flex-col gap-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5"
        style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to clients
      </Link>

      {error !== null ? (
        <ErrorState title="Couldn’t load client" description={error} />
      ) : client === null ? (
        <LoadingState label="Loading client…" />
      ) : (
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ClientAvatar initials={client.initials} size="lg" />
            <div className="flex flex-col gap-0.5">
              <h1 style={TYPE.pageTitle}>{client.name}</h1>
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                <span className="font-data">{client.contractNumber ?? 'No contract number'}</span>
                {client.primaryContact !== null ? ` · ${client.primaryContact}` : null}
              </p>
            </div>
          </div>

          {canUpload ? (
            <Button variant="primary" icon={<Upload aria-hidden="true" size={16} />}>
              Upload
            </Button>
          ) : null}
        </header>
      )}

      <nav
        aria-label="Client profile tabs"
        className="border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {/* Horizontally scrollable on narrow screens so the 6–7 tabs never wrap
            or overflow the viewport. */}
        <ul className="flex gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => {
            const href = `${basePath}/${tab.segment}`;
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={tab.segment} className="shrink-0">
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className="inline-block whitespace-nowrap px-4 py-2"
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
    </PageContainer>
  );
}
