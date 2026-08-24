'use client';

import { PageContainer } from '@/components/ui/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { SettingToggle } from '@/components/ui/SettingToggle';
import { TYPE } from '@/lib/typography';

/**
 * My Settings — a minimal per-user preferences page (any logged-in role, NOT
 * admin-gated). Seeds the future "My Settings" area; for now it holds a single
 * self-serve control: opting your own Outlook mailbox into contact import.
 *
 * The toggle flips ONLY the session user's own email in the allow-list — the
 * backing route (`/api/me/contact-import-consent`) always derives the mailbox
 * from the session and ignores any address in the request body.
 */
export default function MySettingsPage(): React.JSX.Element {
  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>My Settings</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Preferences that apply just to your account.
        </p>
      </header>

      <Card className="p-6">
        <CardHeader
          title="Outlook contacts"
          description="Let Gracie pull your Outlook / Office 365 contacts into the shared contacts list. Off by default — nothing is imported until you turn this on."
        />
        <SettingToggle
          getUrl="/api/me/contact-import-consent"
          patchUrl="/api/me/contact-import-consent"
          responseKey="allowed"
          defaultValue={false}
          label="Allow Gracie to import my Outlook contacts"
          description="You can turn this off any time. It only affects your own mailbox."
        />
      </Card>
    </PageContainer>
  );
}
