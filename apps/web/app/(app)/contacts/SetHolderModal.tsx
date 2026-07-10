'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { Contact, ContactWithAffiliations } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, TextField } from '@/components/ui/Field';

import { contactInitials } from './shared';

/**
 * Fill (or replace) an office's current holder (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * Two modes via a segmented toggle:
 *  - "Existing contact": search `GET /api/contacts?search=` → pick a person → fill via
 *    `POST /api/clients/:id/offices/:officeId/holder { contactId, startedOn }` (which
 *    ends the prior current holder automatically).
 *  - "New contact": `POST /api/contacts { fullName, email, officeId }` creates the person
 *    AND the affiliation in one call. When a start date is given, we instead create the
 *    contact then set the holder so the tenure carries the date (the contacts endpoint
 *    takes no `startedOn`).
 *
 * On success it calls `onSaved()` (the tab re-fetches) and closes.
 */
type Mode = 'existing' | 'new';

interface SetHolderModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly clientId: string;
  readonly officeId: string;
  readonly officeTitle: string;
  /** Current holder's name — shown in the title when replacing. */
  readonly currentHolderName?: string | null;
  readonly onSaved: () => void;
}

export function SetHolderModal({
  isOpen,
  onClose,
  clientId,
  officeId,
  officeTitle,
  currentHolderName = null,
  onSaved,
}: SetHolderModalProps): React.JSX.Element {
  const holderPath = `/api/clients/${clientId}/offices/${officeId}/holder`;

  const [mode, setMode] = useState<Mode>('existing');
  const [startedOn, setStartedOn] = useState('');

  // Existing-contact search.
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<readonly ContactWithAffiliations[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // New-contact fields.
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setMode('existing');
    setStartedOn('');
    setSearch('');
    setResults(null);
    setSearchError(null);
    setFullName('');
    setEmail('');
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  // Debounced contact search (existing mode only).
  useEffect(() => {
    if (!isOpen || mode !== 'existing') return;
    let active = true;
    setSearchError(null);
    const handle = setTimeout(() => {
      apiClient
        .get<{ contacts: readonly ContactWithAffiliations[] }>(
          `/api/contacts?search=${encodeURIComponent(search.trim())}`,
        )
        .then((d) => {
          if (active) setResults(d.contacts);
        })
        .catch((e: unknown) => {
          if (active) setSearchError(e instanceof Error ? e.message : 'Failed to search contacts');
        });
    }, 250);
    return (): void => {
      active = false;
      clearTimeout(handle);
    };
  }, [isOpen, mode, search]);

  function fillExisting(contactId: string): void {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    apiClient
      .post(holderPath, { contactId, startedOn: startedOn.trim() === '' ? undefined : startedOn.trim() })
      .then(() => {
        onSaved();
        onClose();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to set holder'))
      .finally(() => setSubmitting(false));
  }

  async function submitNew(): Promise<void> {
    const name = fullName.trim();
    if (name === '' || submitting) return;
    setSubmitting(true);
    setError(null);
    const started = startedOn.trim();
    const mail = email.trim() === '' ? undefined : email.trim();
    try {
      if (started === '') {
        // One atomic call: create the contact and the office affiliation together.
        await apiClient.post<{ contact: Contact }>('/api/contacts', {
          fullName: name,
          email: mail,
          officeId,
        });
      } else {
        // Start date given → create the person, then fill the office to carry the tenure.
        const { contact } = await apiClient.post<{ contact: Contact }>('/api/contacts', {
          fullName: name,
          email: mail,
        });
        await apiClient.post(holderPath, { contactId: contact.id, startedOn: started });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add contact');
    } finally {
      setSubmitting(false);
    }
  }

  const title = currentHolderName !== null ? `Replace ${currentHolderName}` : 'Set holder';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          {mode === 'new' ? (
            <Button
              variant="primary"
              disabled={submitting || fullName.trim() === ''}
              onClick={(): void => void submitNew()}
            >
              {submitting ? 'Saving…' : 'Add & assign'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Office: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{officeTitle}</span>
        </p>

        <div className="flex items-center gap-1" role="tablist" aria-label="Holder source">
          {(
            [
              { id: 'existing', label: 'Existing contact' },
              { id: 'new', label: 'New contact' },
            ] as const
          ).map((t) => {
            const active = mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={submitting}
                onClick={(): void => setMode(t.id)}
                className="rounded-lg border px-3 py-1.5 transition-colors"
                style={{
                  borderColor: active ? 'var(--color-blue-500)' : 'var(--border-subtle)',
                  backgroundColor: active ? 'var(--color-blue-100)' : '#ffffff',
                  color: active ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                  ...TYPE.bodyStrong,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <TextField
          label="Start date (optional)"
          type="date"
          value={startedOn}
          onChange={setStartedOn}
        />

        {mode === 'existing' ? (
          <div className="flex flex-col gap-3">
            <label className="relative block">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Find a person</span>
              <span className="relative mt-1 block">
                <Search
                  aria-hidden="true"
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-secondary)' }}
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event): void => setSearch(event.target.value)}
                  placeholder="Search by name or email"
                  disabled={submitting}
                  className="w-full rounded-lg border bg-white py-2.5 pl-9 pr-3"
                  style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
                />
              </span>
            </label>

            {searchError !== null ? (
              <FormError message={searchError} />
            ) : results === null ? (
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Searching…</p>
            ) : results.length === 0 ? (
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                No contacts found. Switch to “New contact” to add one.
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {results.map((contact) => {
                  const current = contact.affiliations.find((a) => a.isCurrent);
                  const sub =
                    current !== undefined
                      ? `${current.orgName}${current.officeTitle !== null ? ` · ${current.officeTitle}` : ''}`
                      : contact.email;
                  return (
                    <li key={contact.id}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={(): void => fillExisting(contact.id)}
                        className="flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          background: '#ffffff',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <ClientAvatar
                          initials={contactInitials(contact.fullName)}
                          size="sm"
                          color="var(--color-blue-700)"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate" style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
                            {contact.fullName}
                          </span>
                          {sub !== null && sub !== '' ? (
                            <span className="truncate" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                              {sub}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <FormError message={error} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <TextField
              label="Full name"
              value={fullName}
              onChange={setFullName}
              placeholder="e.g. Jordan Rivera"
              required
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="name@org.gov"
            />
            <FormError message={error} />
          </div>
        )}
      </div>
    </Modal>
  );
}
