'use client';

/**
 * Pipeline errors — admin-only (P9). Lists failed/partial generation runs and lets
 * an admin re-run generation for a meeting. Re-trigger reuses the same generation
 * queue as the Recall webhook; the processor is idempotent per meeting.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface PipelineRunView {
  readonly id: string;
  readonly meetingId: string | null;
  readonly meetingTitle: string | null;
  readonly clientName: string | null;
  readonly meetingDate: string | null;
  readonly status: 'failed' | 'partial' | null;
  readonly source: string;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly canRetrigger: boolean;
}
interface RunsResponse {
  readonly runs: readonly PipelineRunView[];
}

function fmt(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function PipelineErrorsPanel(): React.JSX.Element {
  const [runs, setRuns] = useState<readonly PipelineRunView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const [requeued, setRequeued] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback((): void => {
    setRefreshing(true);
    apiClient
      .get<RunsResponse>('/api/pipeline/runs')
      .then((d) => {
        setRuns(d.runs);
        setLoadError(null);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Failed to load pipeline errors'))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retrigger = useCallback((meetingId: string): void => {
    setInFlight((p) => ({ ...p, [meetingId]: true }));
    setNote(null);
    apiClient
      .post<{ enqueued: boolean }>(`/api/pipeline/${meetingId}/retrigger`)
      .then(() => {
        setRequeued((p) => ({ ...p, [meetingId]: true }));
        setNote({ text: 'Re-queued. Generation is running again for that meeting.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Could not re-run.', ok: false }))
      .finally(() => setInFlight((p) => ({ ...p, [meetingId]: false })));
  }, []);

  if (loadError !== null) return <ErrorState title="Couldn’t load pipeline errors" description={loadError} />;
  if (runs === null) return <LoadingState label="Loading pipeline errors…" />;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 style={TYPE.sectionHeader}>Pipeline errors</h2>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5"
          style={{ ...TYPE.label, color: 'var(--text-secondary)', cursor: refreshing ? 'default' : 'pointer' }}
        >
          <RefreshCw size={14} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        Meetings whose notes/documents failed or only partly generated. Re-run to regenerate from the
        recorded transcript — this replaces the prior output, it doesn’t duplicate.
      </span>

      {runs.length === 0 ? (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)', ...TYPE.secondary }}
        >
          No failed or partial runs. The pipeline is healthy.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Pipeline errors"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <table className="w-full border-collapse" style={{ ...TYPE.secondary, minWidth: '44rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-slate-100)', textAlign: 'left' }}>
                <Th>Meeting</Th>
                <Th>Status</Th>
                <Th>Error</Th>
                <Th>Started</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const busy = r.meetingId !== null && inFlight[r.meetingId] === true;
                const done = r.meetingId !== null && requeued[r.meetingId] === true;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                    <Td>
                      <span style={{ ...TYPE.body, color: 'var(--text-primary)' }}>{r.meetingTitle ?? 'Untitled meeting'}</span>
                      <span style={{ ...TYPE.label, color: 'var(--text-secondary)', display: 'block' }}>
                        {r.clientName ?? 'Unassigned'} · {fmt(r.meetingDate)}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <span
                        title={r.errorMessage ?? undefined}
                        style={{ ...TYPE.label, color: 'var(--text-secondary)', display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {r.errorMessage ?? '—'}
                      </span>
                    </Td>
                    <Td>{fmt(r.startedAt)}</Td>
                    <Td>
                      {done ? (
                        <span style={{ ...TYPE.label, color: 'var(--color-emerald-600)' }}>Re-queued</span>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={(): void => {
                            if (r.meetingId !== null) retrigger(r.meetingId);
                          }}
                          disabled={busy || !r.canRetrigger || r.meetingId === null}
                        >
                          <RotateCw size={14} aria-hidden="true" /> {busy ? 'Re-running…' : 'Re-run'}
                        </Button>
                      )}
                      {!r.canRetrigger && !done ? (
                        <span style={{ ...TYPE.label, color: 'var(--text-secondary)', display: 'block' }}>
                          No recording to re-run from
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {note !== null ? (
        <span role={note.ok ? undefined : 'alert'} style={{ ...TYPE.label, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}>
          {note.text}
        </span>
      ) : null}
    </section>
  );
}

function Th({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <th style={{ ...TYPE.label, color: 'var(--text-secondary)', padding: '8px 12px', fontWeight: 600 }}>{children}</th>;
}
function Td({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <td style={{ padding: '8px 12px' }}>{children}</td>;
}

function StatusBadge({ status }: { readonly status: 'failed' | 'partial' | null }): React.JSX.Element {
  const failed = status === 'failed';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5"
      style={{
        ...TYPE.label,
        color: failed ? 'var(--color-red-700, #b91c1c)' : 'var(--color-amber-700, #b45309)',
        backgroundColor: failed ? 'var(--color-red-50, #fef2f2)' : 'var(--color-amber-50, #fffbeb)',
      }}
    >
      {status ?? 'unknown'}
    </span>
  );
}
