'use client';

import { PageContainer } from '@/components/ui/PageContainer';
import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

import { PipelineErrorsPanel } from './PipelineErrorsPanel';

/**
 * Module 4 — Pipeline Monitor (docs/08 §8 M4). The admin error log + manual
 * re-trigger (P9) render here for admins (`pipeline.viewErrors`). Non-admins see
 * the live-status placeholder; the per-meeting processing badges are surfaced on
 * each client's meetings view.
 */
export default function PipelinePage(): React.JSX.Element {
  const { can } = useAuth();

  if (!can('pipeline.viewErrors')) {
    return (
      <PageContainer>
        <PagePlaceholder
          title="Pipeline"
          description="Live status of meeting document generation."
          emptyTitle="No pipeline activity"
          emptyDescription="Meetings with live processing status badges appear on each client. The error log and manual re-trigger are available to administrators."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Pipeline</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Failed and partial generation runs, with a manual re-trigger. Admin-only.
        </p>
      </header>
      <PipelineErrorsPanel />
    </PageContainer>
  );
}
