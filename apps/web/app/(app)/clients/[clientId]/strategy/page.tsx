'use client';

import { use, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Client, ClientNote, MasterRecordEntry } from '@gracie/shared';

import { getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDate, formatDateTime } from '@/lib/format';
import { cadenceLabel, trendDisplay } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Client tab 2 — Strategy (docs/08 §9). Trajectory indicator, meeting-frequency,
 * risk flags (red), the master-record chronology, and admin notes feed.
 * Trajectory/cadence/risk derive from `GET /api/clients/:id/strategy`; the admin
 * notes feed reads `GET /api/clients/:id/notes` (real Supabase data). User names
 * still resolve through the mock display lookup (users module not yet wired).
 */
interface StrategyResponse {
  readonly client: Client;
  readonly masterRecord: readonly MasterRecordEntry[];
  readonly riskFlags: readonly string[];
}

interface NotesResponse {
  readonly notes: readonly ClientNote[];
}

const TREND_ICON: Readonly<Record<'up' | 'flat' | 'down', LucideIcon>> = {
  up: ArrowUpRight,
  flat: ArrowRight,
  down: ArrowDownRight,
};

export default function ClientStrategyPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);

  const [data, setData] = useState<StrategyResponse | null>(null);
  const [adminNotes, setAdminNotes] = useState<readonly ClientNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<StrategyResponse>(`/api/clients/${clientId}/strategy`),
      apiClient.get<NotesResponse>(`/api/clients/${clientId}/notes`),
    ])
      .then(([strategy, notes]) => {
        if (!active) return;
        setData(strategy);
        setAdminNotes(notes.notes);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load strategy');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  if (error !== null) {
    return <ErrorState title="Couldn’t load strategy" description={error} />;
  }

  if (data === null || adminNotes === null) {
    return <LoadingState label="Loading strategy…" />;
  }

  const { client, masterRecord } = data;
  const trend = trendDisplay(client.relationshipTrend);
  const TrendIcon = trend !== null ? TREND_ICON[trend.direction] : ArrowRight;
  const isAtRisk =
    client.relationshipTrend === 'declining' ||
    (client.relationshipHealth !== null && client.relationshipHealth < 70);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Trajectory */}
        <Card>
          <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Trajectory</p>
          {trend !== null ? (
            <p className="mt-2 flex items-center gap-2" style={{ ...TYPE.sectionHeader, color: trend.color }}>
              <TrendIcon aria-hidden="true" size={22} />
              {trend.label}
            </p>
          ) : (
            <p className="mt-2" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              No trend data.
            </p>
          )}
        </Card>

        {/* Meeting frequency */}
        <Card>
          <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Meeting Frequency</p>
          <p className="mt-2" style={TYPE.sectionHeader}>
            {cadenceLabel(client.cadence)}
          </p>
          <p className="mt-1" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Last meeting{' '}
            {client.lastMeetingAt !== null ? formatDate(client.lastMeetingAt) : 'not recorded'}
          </p>
        </Card>
      </div>

      {/* Risk flags */}
      <Card accent={isAtRisk ? 'critical' : 'none'}>
        <CardHeader title="Risk Flags" />
        {isAtRisk ? (
          <ul className="flex flex-col gap-2">
            {client.relationshipTrend === 'declining' ? (
              <li
                className="flex items-center gap-2"
                style={{ ...TYPE.body, color: 'var(--color-red-600)' }}
              >
                <AlertTriangle aria-hidden="true" size={16} />
                Relationship trend is declining — recommend an executive check-in.
              </li>
            ) : null}
            {client.relationshipHealth !== null && client.relationshipHealth < 70 ? (
              <li
                className="flex items-center gap-2"
                style={{ ...TYPE.body, color: 'var(--color-red-600)' }}
              >
                <AlertTriangle aria-hidden="true" size={16} />
                Relationship health below 70 ({client.relationshipHealth}).
              </li>
            ) : null}
          </ul>
        ) : (
          <EmptyState
            title="No active risk flags"
            description="This relationship has no declining trend or low health score."
          />
        )}
      </Card>

      {/* Master record chronology */}
      <Card>
        <CardHeader
          title="Master Record"
          description="Chronological summary of engagement milestones."
        />
        {masterRecord.length === 0 ? (
          <EmptyState
            title="No master-record entries"
            description="Per-meeting summaries will accumulate here as meetings are processed."
          />
        ) : (
          <ol className="flex flex-col gap-4">
            {masterRecord.map((entry) => (
              <li
                key={entry.id}
                className="border-l-2 pl-4"
                style={{ borderColor: 'var(--color-blue-500)' }}
              >
                <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {formatDateTime(entry.createdAt)}
                </p>
                <p className="mt-1" style={TYPE.body}>
                  {entry.summary}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Admin notes */}
      <Card>
        <CardHeader title="Admin Notes" description="Internal context for this account." />
        {adminNotes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Internal strategy notes for this client will appear here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {adminNotes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border p-3"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <p style={TYPE.body}>{note.content}</p>
                <p className="mt-1" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {getUserName(note.authorUserId)} · {formatDateTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
