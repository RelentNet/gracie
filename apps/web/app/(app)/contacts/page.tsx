'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Client } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { ErrorState } from '@/components/ui/StateViews';

import { AllContactsTab } from './AllContactsTab';
import { OrgChartsTab } from './OrgChartsTab';
import { SuggestionsTab } from './SuggestionsTab';

/**
 * Contacts & Org Charts — top-level area (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * Three in-page sections driven by a segmented control (each drives its own fetch):
 *   1. All contacts — searchable/filterable people list → contact profile.
 *   2. Org charts   — pick an org → the visual office tree (vacant nodes + key flags).
 *   3. Suggestions  — the pending inbox from meeting attendees (editor-only).
 *
 * `orgs` (every party incl. the internal workspace) is loaded once here and shared with
 * the tabs for their org pickers/filters. Read access is `contacts.view` (all roles);
 * edit affordances are gated by `contacts.edit` per tab.
 */
type TabId = 'all' | 'org-charts' | 'suggestions';

interface ClientsResponse {
  readonly clients: readonly Client[];
}

export default function ContactsPage(): React.JSX.Element {
  const { canEdit } = useAuth();
  const editor = canEdit();

  const [tab, setTab] = useState<TabId>('all');
  const [orgs, setOrgs] = useState<readonly Client[] | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<ClientsResponse>('/api/clients?type=all'),
      apiClient.get<ClientsResponse>('/api/clients?type=internal'),
    ])
      .then(([all, internal]) => {
        if (!active) return;
        const merged = [...all.clients, ...internal.clients].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        setOrgs(merged);
      })
      .catch((e: unknown) => {
        if (active) setOrgsError(e instanceof Error ? e.message : 'Failed to load organizations');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const tabs = useMemo<ReadonlyArray<{ readonly id: TabId; readonly label: string }>>(() => {
    const base: Array<{ id: TabId; label: string }> = [
      { id: 'all', label: 'All contacts' },
      { id: 'org-charts', label: 'Org charts' },
    ];
    // Suggestions is an editor triage inbox — hidden for viewers (strictly read-only).
    if (editor) base.push({ id: 'suggestions', label: 'Suggestions' });
    return base;
  }, [editor]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Contacts</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          People, the offices they hold, and who’s missing — across every client and partner.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Contacts sections">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={(): void => setTab(t.id)}
              className="rounded-lg border px-3 py-1.5 transition-colors"
              style={{
                borderColor: active ? 'var(--color-blue-500)' : 'var(--border-subtle)',
                backgroundColor: active ? 'var(--color-blue-100)' : '#ffffff',
                color: active ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                ...TYPE.bodyStrong,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {orgsError !== null ? (
        <ErrorState title="Couldn’t load organizations" description={orgsError} />
      ) : tab === 'all' ? (
        <AllContactsTab orgs={orgs ?? []} canEdit={editor} />
      ) : tab === 'org-charts' ? (
        <OrgChartsTab orgs={orgs ?? []} canEdit={editor} />
      ) : (
        <SuggestionsTab orgs={orgs ?? []} canEdit={editor} />
      )}
    </section>
  );
}
