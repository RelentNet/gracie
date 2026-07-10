'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Client, ContactWithAffiliations } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ClientAvatar } from '@/components/ClientAvatar';

import { NewContactModal } from './NewContactModal';
import { ContactProfileDrawer } from './ContactProfileDrawer';
import { OrgTypeBadge, contactInitials } from './shared';

/**
 * All-contacts tab (phase `CO`) — a searchable, org-filterable list of people. Each row
 * shows the contact's current org affiliations; clicking opens the profile drawer.
 * Editors get "New contact". Search filters client-side; the org filter + include-past
 * toggle drive the fetch.
 */
interface AllContactsTabProps {
  readonly orgs: readonly Client[];
  readonly canEdit: boolean;
}

interface ContactsResponse {
  readonly contacts: readonly ContactWithAffiliations[];
}

export function AllContactsTab({ orgs, canEdit }: AllContactsTabProps): React.JSX.Element {
  const [contacts, setContacts] = useState<readonly ContactWithAffiliations[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [includePast, setIncludePast] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContacts(null);
    setError(null);
    const params = new URLSearchParams();
    if (orgFilter !== '') params.set('clientId', orgFilter);
    if (includePast) params.set('includePast', 'true');
    const qs = params.toString();
    apiClient
      .get<ContactsResponse>(`/api/contacts${qs !== '' ? `?${qs}` : ''}`)
      .then((d) => {
        if (active) setContacts(d.contacts);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load contacts');
      });
    return (): void => {
      active = false;
    };
  }, [orgFilter, includePast, reloadKey]);

  const filtered = useMemo<readonly ContactWithAffiliations[]>(() => {
    if (contacts === null) return [];
    const needle = query.trim().toLowerCase();
    if (needle === '') return contacts;
    return contacts.filter(
      (c) =>
        c.fullName.toLowerCase().includes(needle) || (c.email ?? '').toLowerCase().includes(needle),
    );
  }, [contacts, query]);

  const reload = (): void => setReloadKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          {contacts === null ? 'Loading contacts…' : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}.`}
        </p>
        {canEdit ? (
          <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setShowNew(true)}>
            New contact
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1" style={{ minWidth: '16rem' }}>
          <span className="sr-only">Search contacts by name or email</span>
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-secondary)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e): void => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-lg border bg-white py-2 pl-9 pr-3"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          />
        </label>

        <label className="flex items-center gap-2">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Organization</span>
          <select
            value={orgFilter}
            onChange={(e): void => setOrgFilter(e.target.value)}
            className="rounded-lg border bg-white px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={includePast}
            onChange={(e): void => setIncludePast(e.target.checked)}
          />
          Include past
        </label>
      </div>

      {error !== null ? (
        <ErrorState
          title="Couldn’t load contacts"
          description={error}
          action={
            <Button variant="secondary" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : contacts === null ? (
        <LoadingState label="Loading contacts…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={contacts.length === 0 ? 'No contacts yet' : 'No matching contacts'}
          description={
            contacts.length === 0
              ? 'Add a contact, or accept a suggestion from a recent meeting attendee.'
              : 'No contacts match the current search and filters.'
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((contact) => (
            <li key={contact.id}>
              <ContactCard contact={contact} onOpen={() => setSelectedId(contact.id)} />
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <NewContactModal
          isOpen={showNew}
          onClose={() => setShowNew(false)}
          orgs={orgs}
          onCreated={() => reload()}
        />
      ) : null}

      {selectedId !== null ? (
        <ContactProfileDrawer
          contactId={selectedId}
          isOpen={selectedId !== null}
          onClose={() => setSelectedId(null)}
          orgs={orgs}
          canEdit={canEdit}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}

function ContactCard({
  contact,
  onOpen,
}: {
  readonly contact: ContactWithAffiliations;
  readonly onOpen: () => void;
}): React.JSX.Element {
  const current = contact.affiliations.filter((a) => a.isCurrent);
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left">
      <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <ClientAvatar initials={contactInitials(contact.fullName)} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate" style={TYPE.bodyStrong}>
              {contact.fullName}
            </span>
            <span className="truncate font-data" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              {contact.email ?? 'No email'}
            </span>
          </div>
        </div>
        {current.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {current.slice(0, 3).map((a) => {
              const role = a.officeTitle ?? a.title;
              return (
                <li key={a.id} className="flex items-center gap-2" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  <OrgTypeBadge type={a.orgType} />
                  <span className="truncate">
                    {a.orgName}
                    {role !== null && role !== '' ? ` · ${role}` : ''}
                  </span>
                </li>
              );
            })}
            {current.length > 3 ? (
              <li style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>+{current.length - 3} more</li>
            ) : null}
          </ul>
        ) : (
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No current organization</span>
        )}
      </Card>
    </button>
  );
}
