'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Calendar, CalendarClock, Search } from 'lucide-react';
import type { Client } from '@gracie/shared';

import { MOCK_CLIENTS } from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import {
  cadenceLabel,
  feeTierDisplay,
  healthColor,
  healthLabel,
} from '@/lib/client-display';
import { formatEasternDate } from '@/lib/format';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateViews';
import { CLIENT_CADENCES } from '@gracie/shared';
import type { ClientCadence } from '@gracie/shared';

/**
 * Module 2 — Client List (docs/08 §8 M2, §9). Grid of client cards from the
 * MOCK selector with name + cadence search/filter. The fee-tier dot is rendered
 * ONLY for admins (docs/08 §7 — fee tier is admin-only data). Health score color
 * follows the M2 band (>90 emerald / 70–90 amber / <70 red).
 *
 * Phase 1B: `MOCK_CLIENTS` is replaced by a fetch to `GET /api/clients`; the
 * card markup and role gating stay unchanged.
 */
type CadenceFilter = ClientCadence | 'all';

export default function ClientsPage(): React.JSX.Element {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const [query, setQuery] = useState<string>('');
  const [cadence, setCadence] = useState<CadenceFilter>('all');

  const filtered = useMemo<readonly Client[]>(() => {
    const needle = query.trim().toLowerCase();
    return MOCK_CLIENTS.filter((client) => {
      const matchesName = needle === '' || client.name.toLowerCase().includes(needle);
      const matchesCadence = cadence === 'all' || client.cadence === cadence;
      return matchesName && matchesCadence;
    });
  }, [query, cadence]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Clients</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          {MOCK_CLIENTS.length} active client relationships.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1" style={{ minWidth: '16rem' }}>
          <span className="sr-only">Search clients by name</span>
          <Search
            aria-hidden="true"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-secondary)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(event): void => setQuery(event.target.value)}
            placeholder="Search by client name"
            className="w-full rounded-lg border bg-white py-2 pl-9 pr-3"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          />
        </label>

        <label className="flex items-center gap-2">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Cadence</span>
          <select
            value={cadence}
            onChange={(event): void => setCadence(event.target.value as CadenceFilter)}
            className="rounded-lg border bg-white px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          >
            <option value="all">All</option>
            {CLIENT_CADENCES.map((value) => (
              <option key={value} value={value}>
                {cadenceLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No matching clients"
          description="No clients match the current search and cadence filter. Adjust your filters to see results."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <li key={client.id}>
              <ClientCard client={client} isAdmin={isAdmin} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ClientCard({
  client,
  isAdmin,
}: {
  readonly client: Client;
  readonly isAdmin: boolean;
}): React.JSX.Element {
  const fee = isAdmin ? feeTierDisplay(client.feeTier) : null;
  const health = client.relationshipHealth;

  return (
    <Link href={`/clients/${client.id}`} className="block h-full rounded-lg">
      <Card className="flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <ClientAvatar initials={client.initials} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate" style={TYPE.bodyStrong}>
                {client.name}
              </span>
              {fee !== null ? (
                <span
                  title={`Fee tier: ${fee.label}`}
                  aria-label={`Fee tier ${fee.label}`}
                  style={{ fontSize: '0.75rem' }}
                >
                  {fee.dot}
                </span>
              ) : null}
            </span>
            <span
              className="truncate font-data"
              style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
            >
              {client.contractNumber ?? 'No contract number'}
            </span>
          </div>
        </div>

        <dl className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              <Calendar aria-hidden="true" size={14} />
              Cadence
            </dt>
            <dd style={TYPE.secondary}>{cadenceLabel(client.cadence)}</dd>
          </div>

          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              <CalendarClock aria-hidden="true" size={14} />
              Last meeting
            </dt>
            <dd style={TYPE.secondary}>
              {client.lastMeetingAt !== null ? formatEasternDate(client.lastMeetingAt) : 'None yet'}
            </dd>
          </div>

          <div className="flex items-center justify-between gap-2">
            <dt style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Relationship health</dt>
            <dd className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: healthColor(health) }}
              />
              <span style={{ ...TYPE.bodyStrong, color: healthColor(health) }}>
                {health !== null ? `${health}` : '—'}
              </span>
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {healthLabel(health)}
              </span>
            </dd>
          </div>
        </dl>
      </Card>
    </Link>
  );
}
