'use client';

import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ClientCadenceRow } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import type { CadenceResponse } from '../types';

// ponytail: default-collapsed disclosure. Operator can later decide keep /
// collapse / move — flagged in the PR.
export function CadenceSection(): React.JSX.Element {
  const [rows, setRows] = useState<readonly ClientCadenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Fetch lazily on first expand — a collapsed table shouldn't do work or hit
  // the API on every calendar load.
  useEffect(() => {
    if (!open || rows !== null || error !== null) return;
    let active = true;
    apiClient
      .get<CadenceResponse>('/api/calendar/cadence')
      .then((data) => {
        if (active) setRows(data.cadence);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load cadence');
      });
    return (): void => {
      active = false;
    };
  }, [open, rows, error]);

  return (
    <Card className="p-6 lg:flex-1">
      <CardHeader
        title="Cadence tracker"
        description="Meeting rhythm per client — last meeting, next scheduled, and overdue flags."
        icon={<RefreshCw size={18} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={(): void => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        }
      />
      {open ? (
        <div id={panelId}>
          {error !== null ? (
            <ErrorState title="Couldn’t load cadence" description={error} />
          ) : rows === null ? (
            <LoadingState label="Loading cadence…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No clients"
              description="Cadence appears once clients and meetings exist."
            />
          ) : (
            <div role="region" aria-label="Cadence tracker" tabIndex={0} className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: '44rem' }}>
                <thead>
                  <tr style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                    <th className="px-2 py-1 text-left">Client</th>
                    <th className="px-2 py-1 text-left">Cadence</th>
                    <th className="px-2 py-1 text-left">Last meeting</th>
                    <th className="px-2 py-1 text-left">Next meeting</th>
                    <th className="px-2 py-1 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.clientId}
                      className="border-t"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <td className="px-2 py-2" style={TYPE.bodyStrong}>
                        {row.clientName}
                      </td>
                      <td
                        className="px-2 py-2"
                        style={{ ...TYPE.secondary, textTransform: 'capitalize' }}
                      >
                        {row.cadence.replace('_', ' ')}
                      </td>
                      <td className="px-2 py-2" style={TYPE.secondary}>
                        {row.lastMeetingAt !== null ? formatDateTime(row.lastMeetingAt) : '—'}
                      </td>
                      <td className="px-2 py-2" style={TYPE.secondary}>
                        {row.nextMeetingAt !== null ? formatDateTime(row.nextMeetingAt) : '—'}
                      </td>
                      <td className="px-2 py-2">
                        {row.isOverdue ? (
                          <Badge bg="var(--color-red-100)" fg="var(--color-red-600)">
                            Overdue
                          </Badge>
                        ) : (
                          <Badge bg="var(--color-emerald-100)" fg="var(--color-emerald-600)">
                            On track
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
