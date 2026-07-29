'use client';

/**
 * Pipeline activity feed — admin-only (§3.1). Lists every recent generation run
 * (success / partial / failed / skipped) plus the stuck or in-progress meetings
 * that have no run row yet — the watchdog-flagged `needs_attention` meetings that
 * used to be completely invisible. Filterable by status, with `needs attention`
 * pinned on top. Each row explains in plain language what happened and links to
 * the meeting-occurrence page; admins can re-run generation (idempotent per
 * meeting — it replaces prior output, it doesn't duplicate).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, RotateCw } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import type { FleetReason, FleetState } from '@/lib/pipeline-reason';
import { TYPE } from '@/lib/typography';

interface FleetRowView {
  readonly id: string;
  readonly meetingId: string | null;
  readonly title: string | null;
  readonly client: string | null;
  readonly when: string | null;
  readonly state: FleetState;
  readonly docsCount: number;
  readonly durationS: number | null;
  readonly botJobId: string | null;
  readonly canRetrigger: boolean;
  readonly reason: FleetReason;
}
interface RunsResponse {
  readonly runs: readonly FleetRowView[];
}

type Filter = 'all' | 'needs_attention' | 'in_progress' | 'success' | 'errors';

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'needs_attention', label: 'Needs attention' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'errors', label: 'Errors' },
  { id: 'success', label: 'Success' },
  { id: 'all', label: 'All' },
];

function matchesFilter(state: FleetState, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'errors':
      return state === 'failed' || state === 'partial';
    default:
      return state === filter;
  }
}

const STATE_LABEL: Record<FleetState, string> = {
  success: 'Done',
  partial: 'Partial',
  failed: 'Failed',
  in_progress: 'In progress',
  needs_attention: 'Needs attention',
  skipped: 'Skipped',
};

/** [bg, fg] CSS vars per state — color supplements the text label, never replaces it. */
const STATE_COLOR: Record<FleetState, readonly [string, string]> = {
  success: ['var(--color-emerald-50, #ecfdf5)', 'var(--color-emerald-700, #047857)'],
  partial: ['var(--color-amber-50, #fffbeb)', 'var(--color-amber-700, #b45309)'],
  failed: ['var(--color-red-50, #fef2f2)', 'var(--color-red-700, #b91c1c)'],
  needs_attention: ['var(--color-red-50, #fef2f2)', 'var(--color-red-700, #b91c1c)'],
  in_progress: ['var(--color-sky-50, #f0f9ff)', 'var(--color-sky-700, #0369a1)'],
  skipped: ['var(--color-slate-100, #f1f5f9)', 'var(--text-secondary)'],
};

function fmt(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function PipelineErrorsPanel(): React.JSX.Element {
  const [runs, setRuns] = useState<readonly FleetRowView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('needs_attention');
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
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Failed to load pipeline activity'))
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

  // Counts per filter (for the tab badges) — computed once per load.
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, needs_attention: 0, in_progress: 0, success: 0, errors: 0 };
    for (const r of runs ?? []) {
      for (const f of FILTERS) if (matchesFilter(r.state, f.id)) c[f.id] += 1;
    }
    return c;
  }, [runs]);

  const visible = useMemo(
    () => (runs ?? []).filter((r) => matchesFilter(r.state, filter)),
    [runs, filter],
  );

  if (loadError !== null) return <ErrorState title="Couldn’t load pipeline activity" description={loadError} />;
  if (runs === null) return <LoadingState label="Loading pipeline activity…" />;

  const emptyCopy =
    filter === 'needs_attention'
      ? 'Nothing needs attention. Every meeting either generated its notes or is still processing.'
      : filter === 'errors'
        ? 'No failed or partial runs.'
        : filter === 'in_progress'
          ? 'Nothing is processing right now.'
          : filter === 'success'
            ? 'No completed runs yet.'
            : 'No pipeline activity yet.';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 style={TYPE.sectionHeader}>Recent activity</h2>
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
        Every meeting Gracie tried to write notes for — done, in progress, or stuck. “Needs attention”
        meetings were recorded but never generated their notes; re-run to create them from the recording.
      </span>

      {/* Status filter */}
      <div role="tablist" aria-label="Filter pipeline activity" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={(): void => setFilter(f.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
              style={{
                ...TYPE.label,
                cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                backgroundColor: active ? 'var(--text-primary)' : 'transparent',
                color: active ? 'var(--color-white, #fff)' : 'var(--text-secondary)',
              }}
            >
              {f.label}
              <span style={{ opacity: 0.7 }}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)', ...TYPE.secondary }}
        >
          {emptyCopy}
        </div>
      ) : (
        <div
          role="region"
          aria-label="Pipeline activity"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <table className="w-full border-collapse" style={{ ...TYPE.secondary, minWidth: '52rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-slate-100)', textAlign: 'left' }}>
                <Th>Meeting</Th>
                <Th>Status</Th>
                <Th>What happened</Th>
                <Th>When</Th>
                <Th>Docs</Th>
                <Th>Time</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const busy = r.meetingId !== null && inFlight[r.meetingId] === true;
                const done = r.meetingId !== null && requeued[r.meetingId] === true;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>
                    <Td>
                      {r.meetingId !== null ? (
                        <Link
                          href={`/meetings/${r.meetingId}`}
                          style={{ ...TYPE.body, color: 'var(--text-link, var(--text-primary))', textDecoration: 'underline' }}
                        >
                          {r.title ?? 'Untitled meeting'}
                        </Link>
                      ) : (
                        <span style={{ ...TYPE.body, color: 'var(--text-primary)' }}>{r.title ?? 'Untitled meeting'}</span>
                      )}
                      <span style={{ ...TYPE.label, color: 'var(--text-secondary)', display: 'block' }}>
                        {r.client ?? 'Unassigned'}
                      </span>
                    </Td>
                    <Td>
                      <Badge bg={STATE_COLOR[r.state][0]} fg={STATE_COLOR[r.state][1]}>
                        {STATE_LABEL[r.state]}
                      </Badge>
                    </Td>
                    <Td>
                      <span
                        title={r.reason.detail ?? undefined}
                        style={{ ...TYPE.label, color: 'var(--text-secondary)', display: 'inline-block', maxWidth: 340 }}
                      >
                        {r.reason.headline}
                      </span>
                    </Td>
                    <Td>{fmt(r.when)}</Td>
                    <Td>{r.docsCount > 0 ? r.docsCount : '—'}</Td>
                    <Td>{fmtDuration(r.durationS)}</Td>
                    <Td>
                      {done ? (
                        <span style={{ ...TYPE.label, color: 'var(--color-emerald-600)' }}>Re-queued</span>
                      ) : r.state === 'in_progress' ? (
                        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Running…</span>
                      ) : r.canRetrigger && r.meetingId !== null ? (
                        <Button
                          variant="secondary"
                          onClick={(): void => {
                            if (r.meetingId !== null) retrigger(r.meetingId);
                          }}
                          disabled={busy}
                        >
                          <RotateCw size={14} aria-hidden="true" /> {busy ? 'Re-running…' : 'Re-run'}
                        </Button>
                      ) : (
                        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Nothing to re-run</span>
                      )}
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
