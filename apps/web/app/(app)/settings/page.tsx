'use client';

import { PageContainer } from '@/components/ui/PageContainer';
import { ErrorState } from '@/components/ui/StateViews';
import { Tabs } from '@/components/ui/Tabs';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

import { AiSettingsPanel } from './AiSettingsPanel';
import { ApiSettingsPanel } from './ApiSettingsPanel';
import { AutomationsSettingsPanel } from './AutomationsSettingsPanel';
import { BotSettingsPanel } from './BotSettingsPanel';
import { CompanySettingsPanel } from './CompanySettingsPanel';
import { DailySyncSettingsPanel } from './DailySyncSettingsPanel';
import { GenerationPromptsPanel } from './GenerationPromptsPanel';
import { NotificationSettingsPanel } from './NotificationSettingsPanel';
import { ScoringSettingsPanel } from './ScoringSettingsPanel';
import { UsersPanel } from './UsersPanel';

/**
 * Module 12 — Settings (docs/08 §8 M12, §10). Admin-only. Hidden from the sidebar
 * for non-admins; this guard is defense-in-depth so a direct URL visit yields no
 * admin content (mirrors server omission, D14).
 *
 * Sections: Users, Company, Meeting Bot, Notifications, Automations, Scoring, AI
 * Model, and API Settings. The team-wide meeting-dispatch master switches (global
 * bot kill-switch + on-demand join) live under Meeting Bot; the per-user
 * "auto-join meetings I lead" preference stays on the Calendar page.
 */
export default function SettingsPage(): React.JSX.Element {
  const { can } = useAuth();

  if (!can('settings.access')) {
    return (
      <PageContainer className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Settings</h1>
        </header>
        <ErrorState
          title="Access restricted"
          description="Settings is available to administrators only."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Settings</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Manage users and roles, and integration API keys. Keys are encrypted at rest and never
          displayed; removing one falls back to the environment variable.
        </p>
      </header>

      <Tabs
        ariaLabel="Settings sections"
        items={[
          { id: 'users', label: 'Users', content: <UsersPanel /> },
          { id: 'company', label: 'Company', content: <CompanySettingsPanel /> },
          { id: 'bot', label: 'Meeting Bot', content: <BotSettingsPanel /> },
          { id: 'daily-sync', label: 'Daily Sync', content: <DailySyncSettingsPanel /> },
          { id: 'notifications', label: 'Notifications', content: <NotificationSettingsPanel /> },
          { id: 'automations', label: 'Automations', content: <AutomationsSettingsPanel /> },
          { id: 'scoring', label: 'Scoring', content: <ScoringSettingsPanel /> },
          { id: 'prompts', label: 'Generation Prompts', content: <GenerationPromptsPanel /> },
          { id: 'ai', label: 'AI Provider', content: <AiSettingsPanel /> },
          { id: 'api', label: 'API Settings', content: <ApiSettingsPanel /> },
          {
            id: 'roadmap',
            label: 'Roadmap',
            // /roadmap is a raw-HTML route handler (its own <head>/SVG); embed it
            // verbatim in an iframe rather than inlining the markup. Same-origin,
            // already-authed session loads it fine. Admin-only via settings.access.
            content: (
              <iframe
                src="/roadmap"
                title="Build roadmap"
                className="w-full rounded-lg border"
                style={{ height: '80vh', borderColor: 'var(--border-subtle)' }}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
