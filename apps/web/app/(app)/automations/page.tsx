'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

import { AutomationCard } from './AutomationCard';
import { AdvancedRequestsPanel } from './AdvancedRequestsPanel';
import type { AutomationClientView } from './types';

/**
 * `/automations` — Gracie Automations management (P8 §6). Non-technical users
 * create automations by ASKING Gracie in chat (she proposes → they confirm); this
 * page is where everyone manages what exists: a user sees their own automations, an
 * admin sees everyone's. Row actions (Run now / Pause / Resume / Delete, and
 * Confirm / Cancel for pending proposals) require the editor tier — viewers are
 * read-only. Admins also get the advanced-requests inbox.
 */
export default function AutomationsPage(): React.JSX.Element {
  const { can, user } = useAuth();
  const canView = can('automations.view');
  const canEdit = can('automations.edit');
  const isAdmin = user.role === 'admin';

  const [automations, setAutomations] = useState<AutomationClientView[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch('/api/automations', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load automations (${res.status})`);
      const data = (await res.json()) as { automations: AutomationClientView[]; isAdmin: boolean };
      setAutomations(data.automations);
      setShowAll(data.isAdmin);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load automations');
      setAutomations([]);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView) {
    return (
      <PageContainer className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Automations</h1>
        </header>
        <ErrorState title="Access restricted" description="You don’t have access to automations." />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Automations</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Recurring reports and tasks Gracie runs for you — from hourly digests to a brief before each
          client meeting. Ask Gracie in the Assistant to create one (“email me a portfolio digest every
          Monday”, “brief me 15 minutes before every client meeting”) — she’ll propose it and you confirm
          it here or in chat. {showAll ? 'You’re viewing everyone’s automations.' : 'You’re viewing your automations.'}
        </p>
      </header>

      {isAdmin ? (
        <CollapsibleSection
          title="Advanced requests"
          description="Things teammates asked Gracie to automate that aren’t available yet."
          storageKey="automations-advanced-requests"
          defaultOpen={false}
        >
          <AdvancedRequestsPanel />
        </CollapsibleSection>
      ) : null}

      {error !== null ? (
        <ErrorState title="Couldn’t load automations" description={error} />
      ) : automations === null ? (
        <LoadingState label="Loading automations…" />
      ) : automations.length === 0 ? (
        <EmptyState
          title="No automations yet"
          description="Open the Assistant and ask Gracie to set one up — for example, “send me a client report for Acme every Friday morning” or “brief me 15 minutes before every client meeting.”"
          action={
            <span className="inline-flex items-center gap-1" style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}>
              <Sparkles size={14} aria-hidden="true" /> Ask Gracie in the Assistant
            </span>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              canEdit={canEdit}
              showOwner={showAll}
              onChanged={(): void => void load()}
              onError={(msg): void => setError(msg === '' ? null : msg)}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
