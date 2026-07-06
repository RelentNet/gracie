'use client';

import { ErrorState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

import { ApiSettingsPanel } from './ApiSettingsPanel';
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

      <div className="flex flex-col gap-3">
        <h2 style={TYPE.sectionHeader}>Users</h2>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Manage who is an admin, standard, or viewer, and offboard accounts. Admins can change any
          user&rsquo;s role.
        </p>
        <UsersPanel />
      </div>

      <div className="flex flex-col gap-3">
        <h2 style={TYPE.sectionHeader}>API Settings</h2>
        <ApiSettingsPanel />
      </div>
    </section>
  );
}
