'use client';

import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { ErrorState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

import { ApiSettingsPanel } from './ApiSettingsPanel';
import { AutomationsSettingsPanel } from './AutomationsSettingsPanel';
import { BotSettingsPanel } from './BotSettingsPanel';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { ScoringSettingsPanel } from './ScoringSettingsPanel';
import { UsersPanel } from './UsersPanel';

/**
 * Module 12 — Settings (docs/08 §8 M12, §10). Admin-only. Hidden from the sidebar
 * for non-admins; this guard is defense-in-depth so a direct URL visit yields no
 * admin content (mirrors server omission, D14).
 *
 * API Settings (integration credentials) is live here; company settings, calendar
 * automation, and user management arrive in later phases.
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
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Settings</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Manage users and roles, and integration API keys. Keys are encrypted at rest and never
          displayed; removing one falls back to the environment variable.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <CollapsibleSection
          title="Users"
          description="Manage who is an admin, standard, or viewer, and offboard accounts."
          storageKey="settings-users"
        >
          <UsersPanel />
        </CollapsibleSection>

        <CollapsibleSection
          title="Meeting Bot"
          description="How Gracie appears and behaves when she joins a call — name, image tile, and auto-leave."
          storageKey="settings-bot"
        >
          <BotSettingsPanel />
        </CollapsibleSection>

        <CollapsibleSection
          title="Notifications"
          description="Which internal emails Gracie sends. She only ever emails your own team."
          storageKey="settings-notifications"
        >
          <NotificationSettingsPanel />
        </CollapsibleSection>

        <CollapsibleSection
          title="Automations"
          description="The customer-contact master switch for Gracie's automations (off by default)."
          storageKey="settings-automations"
        >
          <AutomationsSettingsPanel />
        </CollapsibleSection>

        <CollapsibleSection
          title="Scoring"
          description="Tune the relationship-health algorithm — signal weights and thresholds. Saving recomputes every client."
          storageKey="settings-scoring"
        >
          <ScoringSettingsPanel />
        </CollapsibleSection>

        <CollapsibleSection
          title="API Settings"
          description="Third-party integration keys. Encrypted at rest and never displayed."
          storageKey="settings-api"
        >
          <ApiSettingsPanel />
        </CollapsibleSection>
      </div>
    </section>
  );
}
