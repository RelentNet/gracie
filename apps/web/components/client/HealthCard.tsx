'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { ClientHealth, HealthSignalBreakdown, HealthSignalKey } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { healthColor, healthLabel, trendDisplay } from '@/lib/client-display';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

/**
 * Overview → Relationship Health (P2.1). The score is ALGORITHMIC — auto-computed by
 * the worker from weighted signals — so it's read-only with an "auto" badge and a
 * "How it's computed" breakdown. Admins can override an INDIVIDUAL signal's value with
 * a reason (`POST/DELETE /api/clients/:id/health`); the score stays computed and
 * refreshes on the next recompute. Fetches its own detail so the breakdown is fresh.
 */
const SIGNAL_LABELS: Readonly<Record<HealthSignalKey, string>> = {
  cadenceAdherence: 'Cadence adherence',
  meetingRecency: 'Meeting recency',
  openOverdueTasks: 'Open / overdue tasks',
  completionRate: 'Task completion',
};

export function HealthCard({
  clientId,
  fallbackScore,
}: {
  readonly clientId: string;
  readonly fallbackScore: number | null;
}): React.JSX.Element {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const [health, setHealth] = useState<ClientHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [recomputing, setRecomputing] = useState<boolean>(false);

  async function refresh(): Promise<void> {
    try {
      const { health: next } = await apiClient.get<{ health: ClientHealth }>(
        `/api/clients/${clientId}/health`,
      );
      setHealth(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health');
    }
  }

  useEffect(() => {
    void refresh();
  }, [clientId]);

  const score = health?.score ?? fallbackScore;
  const trend = health !== null ? trendDisplay(health.trend) : null;

  return (
    <Card style={{ borderTop: `3px solid ${healthColor(score)}` }}>
      <div className="flex items-start justify-between gap-2">
        <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Relationship Health</p>
        <Badge bg="var(--color-slate-100)" fg="var(--text-secondary)">
          Auto
        </Badge>
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span style={{ ...TYPE.pageTitle, color: healthColor(score) }}>{score ?? '—'}</span>
        <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>/ 100</span>
      </p>
      <p className="mt-1 flex items-center gap-2" style={{ ...TYPE.secondary, color: healthColor(score) }}>
        {healthLabel(score)}
        {trend !== null ? <span style={{ color: trend.color }}>· {trend.label}</span> : null}
      </p>

      {health?.updatedAt != null ? (
        <p className="mt-1" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Updated {formatDateTime(health.updatedAt)}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-2" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={(): void => setExpanded((v) => !v)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md"
        style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', background: 'transparent', cursor: 'pointer' }}
      >
        <Info aria-hidden="true" size={14} />
        How it’s computed
        {expanded ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
      </button>

      {expanded ? (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          {recomputing ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              Adjustment saved — the score refreshes on the next recompute.
            </p>
          ) : null}
          {health === null ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Loading breakdown…</p>
          ) : health.breakdown === null ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              Not computed yet — the score is set on the next recompute.
            </p>
          ) : (
            health.breakdown.signals.map((signal) => (
              <SignalRow
                key={signal.key}
                clientId={clientId}
                signal={signal}
                isAdmin={isAdmin}
                onAdjusted={(): void => {
                  setRecomputing(true);
                  void refresh();
                }}
              />
            ))
          )}
        </div>
      ) : null}
    </Card>
  );
}

function SignalRow({
  clientId,
  signal,
  isAdmin,
  onAdjusted,
}: {
  readonly clientId: string;
  readonly signal: HealthSignalBreakdown;
  readonly isAdmin: boolean;
  readonly onAdjusted: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [value, setValue] = useState<string>(String(signal.effective ?? signal.computed ?? 0));
  const [reason, setReason] = useState<string>(signal.adjustmentReason ?? '');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const shown = signal.effective ?? signal.computed;

  async function saveAdjustment(): Promise<void> {
    const numeric = Number(value);
    if (busy) return;
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      setError('Value must be 0–100.');
      return;
    }
    if (reason.trim() === '') {
      setError('A reason is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/clients/${clientId}/health`, {
        signal: signal.key,
        value: numeric,
        reason: reason.trim(),
      });
      setEditing(false);
      onAdjusted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function clearAdjustment(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.del(`/api/clients/${clientId}/health?signal=${signal.key}`);
      setEditing(false);
      onAdjusted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2" style={TYPE.secondary}>
          {SIGNAL_LABELS[signal.key]}
          <span style={{ color: 'var(--text-secondary)' }}>({signal.weight}%)</span>
          {signal.adjusted ? (
            <Badge bg="var(--color-amber-100)" fg="var(--color-amber-600)">
              Adjusted
            </Badge>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
            {shown === null ? 'n/a' : Math.round(shown)}
          </span>
          {isAdmin && !editing ? (
            <button
              type="button"
              onClick={(): void => setEditing(true)}
              style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', background: 'transparent', cursor: 'pointer' }}
            >
              Adjust
            </button>
          ) : null}
        </span>
      </div>

      {signal.adjusted && !editing && signal.adjustmentReason !== null ? (
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>“{signal.adjustmentReason}”</p>
      ) : null}

      {editing ? (
        <div className="mt-1 flex flex-col gap-2 rounded-md border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={value}
              onChange={(e): void => setValue(e.target.value)}
              className="w-20 rounded-md border p-1.5"
              style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
              aria-label={`${SIGNAL_LABELS[signal.key]} value`}
            />
            <input
              type="text"
              value={reason}
              onChange={(e): void => setReason(e.target.value)}
              placeholder="Reason (required)"
              className="min-w-0 flex-1 rounded-md border p-1.5"
              style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
              aria-label="Adjustment reason"
            />
          </div>
          {error !== null ? (
            <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {signal.adjusted ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={(): void => void clearAdjustment()}>
                Clear
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" disabled={busy} onClick={(): void => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={(): void => void saveAdjustment()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
