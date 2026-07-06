'use client';

import { useCallback, useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import type { ClientDomain } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Domains manager on the client profile (P4.1 follow-on). A domain is the primary
 * calendar→org match key (`client_domains`, globally unique): registering one here
 * links every existing meeting on it to this org and matches future meetings —
 * this is how a multi-domain client (e.g. IBM = ibm.com + us.ibm.com) picks up the
 * meetings it was missing. Add rejects free-email / internal / already-taken
 * domains with a clear message. Editor-only (the caller renders it only for the
 * editor tier); the reserved internal workspace has no domain manager.
 */
export function ClientDomainsCard({ clientId }: { readonly clientId: string }): React.JSX.Element {
  const [domains, setDomains] = useState<readonly ClientDomain[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [input, setInput] = useState('');
  /** In-flight action: 'add' or `remove:<domain>` (disables the relevant control). */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDomains(null);
    setLoadError(null);
    apiClient
      .get<{ domains: readonly ClientDomain[] }>(`/api/clients/${clientId}/domains`)
      .then((d) => {
        if (active) setDomains(d.domains);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load domains');
      });
    return (): void => {
      active = false;
    };
  }, [clientId, reloadKey]);

  const add = useCallback((): void => {
    const domain = input.trim();
    if (domain === '') return;
    setBusy('add');
    setActionError(null);
    apiClient
      .post<{ domains: readonly ClientDomain[] }>(`/api/clients/${clientId}/domains`, { domain })
      .then((d) => {
        setDomains(d.domains);
        setInput('');
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : 'Failed to add domain'))
      .finally(() => setBusy(null));
  }, [clientId, input]);

  const remove = useCallback(
    (domain: string): void => {
      setBusy(`remove:${domain}`);
      setActionError(null);
      apiClient
        .del<{ domains: readonly ClientDomain[] }>(
          `/api/clients/${clientId}/domains?domain=${encodeURIComponent(domain)}`,
        )
        .then((d) => setDomains(d.domains))
        .catch((e: unknown) =>
          setActionError(e instanceof Error ? e.message : 'Failed to remove domain'),
        )
        .finally(() => setBusy(null));
    },
    [clientId],
  );

  return (
    <Card>
      <CardHeader
        title="Domains"
        description="Meetings whose attendees use these email domains are matched to this client."
      />

      <form
        className="flex items-center gap-2"
        onSubmit={(e): void => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2"
          style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          placeholder="us.ibm.com"
          value={input}
          onChange={(e): void => setInput(e.target.value)}
          disabled={busy === 'add'}
          aria-label="New domain"
        />
        <Button type="submit" variant="secondary" disabled={busy === 'add' || input.trim() === ''}>
          {busy === 'add' ? 'Adding…' : 'Add'}
        </Button>
      </form>

      {actionError !== null ? (
        <span
          role="alert"
          className="mt-2 block"
          style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}
        >
          {actionError}
        </span>
      ) : null}

      <div className="mt-4">
        {loadError !== null ? (
          <ErrorState
            title="Couldn’t load domains"
            description={loadError}
            action={
              <Button variant="secondary" onClick={(): void => setReloadKey((k) => k + 1)}>
                Retry
              </Button>
            }
          />
        ) : domains === null ? (
          <LoadingState label="Loading domains…" />
        ) : domains.length === 0 ? (
          <EmptyState
            title="No domains yet"
            description="Add a domain to match this client’s meetings automatically."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {domains.map((d) => {
              const removing = busy === `remove:${d.domain}`;
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span
                    className="inline-flex items-center gap-2 font-data"
                    style={{ ...TYPE.body, color: 'var(--text-primary)' }}
                  >
                    <Globe size={14} aria-hidden="true" />
                    {d.domain}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${d.domain}`}
                    onClick={(): void => remove(d.domain)}
                    disabled={removing}
                    style={{
                      color: 'var(--text-secondary)',
                      cursor: removing ? 'wait' : 'pointer',
                      lineHeight: 0,
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
