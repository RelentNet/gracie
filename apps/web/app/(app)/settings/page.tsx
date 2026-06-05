'use client';

import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { ErrorState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

/**
 * Module 12 — Settings (docs/08 §8 M12, §10). Admin-only. The page is hidden
 * from the sidebar for non-admins; this guard is defense-in-depth so a direct
 * URL visit still yields no admin content (mirrors server omission, D14).
 *
 * Phase 1B: API Settings cards (Recall, AI Provider, Resend, R2, Graph, etc.)
 * render here, backed by `integration_credentials`.
 */
export default function SettingsPage(): React.JSX.Element {
  const { can } = useAuth();

  if (!can('settings.access')) {
    return (
      <section className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Settings</h1>
        </header>
        <ErrorState
          title="Access restricted"
          description="Settings is available to administrators only."
        />
      </section>
    );
  }

  return (
    <PagePlaceholder
      title="Settings"
      description="Company settings, calendar automation, integrations, and users."
      emptyTitle="Configuration coming soon"
      emptyDescription="Company settings, API Settings (integration credentials + AI provider selection), and user management will appear here in a later phase."
    />
  );
}
