'use client';

/**
 * Contacts settings (Settings → Contacts, admin-only). Manages the Outlook-import
 * consent allow-list: only mailboxes on this list can be imported (Contacts →
 * Import from Outlook), even by an admin — the Azure `Contacts.Read` grant is
 * tenant-wide, so this is the app-level opt-in gate.
 *
 * Every app user gets a toggle (on = their email is allowed). A small field allows
 * a mailbox that isn't an app user (e.g. a shared/assistant mailbox); those show
 * with a Remove control. Web-only — no Graph/worker call to enumerate mailboxes.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ClientAvatar } from '@/components/ClientAvatar';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

const CONSENT_URL = '/api/settings/contact-import-consent';

interface RosterUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
}

interface ConsentData {
  readonly mailboxes: readonly string[];
  readonly users: readonly RosterUser[];
}

export function ContactsSettingsPanel(): React.JSX.Element {
  const [data, setData] = useState<ConsentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // mailbox currently saving
  const [newMailbox, setNewMailbox] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ConsentData>(CONSENT_URL)
      .then((d) => active && setData(d))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Failed to load'));
    return (): void => {
      active = false;
    };
  }, []);

  const setConsent = useCallback(
    async (mailbox: string, allow: boolean): Promise<void> => {
      setBusy(mailbox.toLowerCase());
      setError(null);
      try {
        const { mailboxes } = await apiClient.patch<{ mailboxes: string[] }>(CONSENT_URL, {
          mailbox,
          allow,
        });
        setData((cur) => (cur === null ? cur : { ...cur, mailboxes }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  async function addMailbox(): Promise<void> {
    const mb = newMailbox.trim().toLowerCase();
    if (mb === '' || !mb.includes('@')) {
      setAddError('Enter a mailbox email address.');
      return;
    }
    setAddError(null);
    await setConsent(mb, true);
    setNewMailbox('');
  }

  if (error !== null && data === null) return <ErrorState title="Couldn’t load" description={error} />;
  if (data === null) return <LoadingState label="Loading…" />;

  const allowed = new Set(data.mailboxes.map((m) => m.toLowerCase()));
  const userEmails = new Set(data.users.map((u) => u.email.toLowerCase()));
  // Allowed mailboxes that aren't app users (e.g. Joe / a shared mailbox).
  const extras = data.mailboxes.filter((m) => !userEmails.has(m.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <CardHeader
          title="Outlook contact import"
          description="Only mailboxes allowed here can be imported from Outlook (Contacts → Import from Outlook). Off by default — Gracie never reads a mailbox that hasn’t opted in."
        />

        <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {data.users.map((u) => {
            const on = allowed.has(u.email.toLowerCase());
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ClientAvatar initials={u.initials} size="md" color="var(--color-blue-600)" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate" style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
                      {u.name}
                    </span>
                    <span className="truncate" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                      {u.email}
                    </span>
                  </div>
                </div>
                <ToggleSwitch
                  checked={on}
                  disabled={busy === u.email.toLowerCase()}
                  onChange={(next): void => void setConsent(u.email, next)}
                  label={on ? 'Allowed' : 'Off'}
                  ariaLabel={`Allow importing ${u.email}`}
                />
              </div>
            );
          })}
          {data.users.length === 0 ? (
            <EmptyState title="No users yet" description="App users appear here once they sign in." />
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <CardHeader
          title="Other mailboxes"
          description="Allow a mailbox that isn’t an app user — e.g. a shared or assistant mailbox."
        />
        <div className="flex flex-col gap-3">
          {extras.map((m) => (
            <div key={m} className="flex items-center justify-between gap-3">
              <span className="truncate" style={{ ...TYPE.body, color: 'var(--text-primary)' }}>
                {m}
              </span>
              <Button
                variant="secondary"
                onClick={(): void => void setConsent(m, false)}
                disabled={busy === m.toLowerCase()}
              >
                <Trash2 aria-hidden="true" size={14} /> Remove
              </Button>
            </div>
          ))}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Allow another mailbox"
                type="email"
                value={newMailbox}
                onChange={setNewMailbox}
                placeholder="joe@graceandassociates.com"
                disabled={busy !== null}
              />
            </div>
            <Button variant="primary" onClick={() => void addMailbox()} disabled={busy !== null}>
              Add
            </Button>
          </div>
          {addError !== null ? (
            <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
              {addError}
            </span>
          ) : null}
        </div>
      </Card>

      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
