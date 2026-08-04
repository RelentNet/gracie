'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Client } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import { orgTypeLabel } from '../lib/calendar-meeting';

/** Modal: link an existing (non-internal) org to a meeting. */
export function LinkExistingModal({
  meetingId,
  linkedIds,
  unknownDomains,
  onClose,
  onLinked,
}: {
  readonly meetingId: string;
  readonly linkedIds: readonly string[];
  /** Unknown external domains on this meeting — offered to register on the org. */
  readonly unknownDomains: readonly string[];
  readonly onClose: () => void;
  readonly onLinked: () => void;
}): React.JSX.Element {
  const [clients, setClients] = useState<readonly Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>('');
  // Which unknown domains to also register on the linked org (default all on) —
  // this is what teaches a multi-domain client (e.g. us.ibm.com) its new domain.
  const [registerDomains, setRegisterDomains] = useState<readonly string[]>(unknownDomains);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ clients: readonly Client[] }>('/api/clients?type=all')
      .then((d) => {
        if (active) setClients(d.clients);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load orgs');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const toggleDomain = useCallback((domain: string): void => {
    setRegisterDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain],
    );
  }, []);

  const options = (clients ?? []).filter((c) => !linkedIds.includes(c.id));

  const submit = useCallback((): void => {
    if (choice === '') return;
    setSubmitting(true);
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meetingId}/orgs`, {
        clientId: choice,
        action: 'link',
        registerDomains,
      })
      .then(() => onLinked())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to link org'))
      .finally(() => setSubmitting(false));
  }, [meetingId, choice, registerDomains, onLinked]);

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Link an existing org"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting || choice === ''}>
            {submitting ? 'Linking…' : 'Link'}
          </Button>
        </>
      }
    >
      {loadError !== null ? (
        <ErrorState title="Couldn’t load orgs" description={loadError} />
      ) : clients === null ? (
        <LoadingState label="Loading orgs…" />
      ) : options.length === 0 ? (
        <EmptyState
          title="No orgs to link"
          description="Every existing org is already linked, or none exist yet."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Organization</span>
            <select
              className={inputClass}
              style={inputStyle}
              value={choice}
              onChange={(e): void => setChoice(e.target.value)}
            >
              <option value="">Select an org…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.type !== 'client' ? ` (${orgTypeLabel(c.type)})` : ''}
                </option>
              ))}
            </select>
          </label>
          {unknownDomains.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                Also add to this org’s domains
              </legend>
              {unknownDomains.map((domain) => (
                <label key={domain} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={registerDomains.includes(domain)}
                    onChange={(): void => toggleDomain(domain)}
                  />
                  <span
                    className="font-data"
                    style={{ ...TYPE.label, color: 'var(--text-primary)' }}
                  >
                    {domain}
                  </span>
                </label>
              ))}
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                Registers the domain and links its other meetings. Uncheck any that don’t belong to
                this org.
              </span>
            </fieldset>
          ) : null}
          {error !== null ? (
            <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
              {error}
            </span>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
