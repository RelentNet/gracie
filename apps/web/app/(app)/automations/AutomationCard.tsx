'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Play, Trash2, Pause, PlayCircle, Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';

import { AUTOMATION_TYPE_LABELS, recipientsSummary, type AutomationClientView } from './types';

/**
 * One automation row: title + status, schedule + recipients, last/next run, and
 * role-gated actions. A `pending_confirmation` row offers Confirm/Cancel (the
 * fallback for the chat confirm card); an active/paused row offers Run now, Pause/
 * Resume, and Delete. External-recipient automations show a distinct warning badge
 * and require an extra confirmation on Confirm.
 */

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending_confirmation: { bg: 'var(--color-amber-100, #fef3c7)', fg: 'var(--color-amber-700, #b45309)', label: 'Needs confirmation' },
  active: { bg: 'var(--color-emerald-100, #d1fae5)', fg: 'var(--color-emerald-700, #047857)', label: 'Active' },
  paused: { bg: 'var(--color-slate-100)', fg: 'var(--text-secondary)', label: 'Paused' },
  cancelled: { bg: 'var(--color-slate-100)', fg: 'var(--text-secondary)', label: 'Cancelled' },
};

const RUN_STATUS_COLOR: Record<string, string> = {
  success: 'var(--color-emerald-600, #059669)',
  failed: 'var(--color-red-600, #dc2626)',
  skipped: 'var(--color-amber-700, #b45309)',
};

export function AutomationCard({
  automation,
  canEdit,
  showOwner,
  onChanged,
  onError,
}: {
  readonly automation: AutomationClientView;
  readonly canEdit: boolean;
  readonly showOwner: boolean;
  readonly onChanged: () => void;
  readonly onError: (message: string) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const a = automation;
  const status: { bg: string; fg: string; label: string } =
    STATUS_STYLE[a.status] ?? { bg: 'var(--color-slate-100)', fg: 'var(--text-secondary)', label: a.status };

  async function call(path: string, method: string, body?: unknown): Promise<Response> {
    return fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function run<T>(fn: () => Promise<T>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    onError('');
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function confirm(withExternal = false): Promise<void> {
    const res = await call(`/api/automations/${a.id}/confirm`, 'POST', withExternal ? { confirmExternal: true } : {});
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      if (body?.error?.code === 'external_confirmation_required') {
        if (
          window.confirm(
            'This automation emails a client (external recipient) directly. Approve the external send?',
          )
        ) {
          await confirm(true);
        }
        return;
      }
      onError(body?.error?.message ?? 'Failed to confirm automation');
      return;
    }
    onChanged();
  }

  async function cancel(): Promise<void> {
    const res = await call(`/api/automations/${a.id}/cancel`, 'POST');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(body?.error?.message ?? 'Failed to cancel');
      return;
    }
    onChanged();
  }

  async function runNow(): Promise<void> {
    const res = await call(`/api/automations/${a.id}/run`, 'POST');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(body?.error?.message ?? 'Failed to run');
      return;
    }
    setNote(a.isEventTrigger ? 'Queued — briefing your next matching meeting.' : 'Queued — it will run shortly.');
    setTimeout(onChanged, 2500);
  }

  async function setPaused(paused: boolean): Promise<void> {
    const res = await call(`/api/automations/${a.id}`, 'PATCH', { paused });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(body?.error?.message ?? 'Failed to update');
      return;
    }
    onChanged();
  }

  async function remove(): Promise<void> {
    if (!window.confirm('Delete this automation? This cannot be undone.')) return;
    const res = await call(`/api/automations/${a.id}`, 'DELETE');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(body?.error?.message ?? 'Failed to delete');
      return;
    }
    onChanged();
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-white p-4"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span style={TYPE.bodyStrong} className="truncate">
              {a.title}
            </span>
            <Badge bg={status.bg} fg={status.fg}>
              {status.label}
            </Badge>
            {a.hasExternalRecipient ? (
              <Badge
                bg="var(--color-amber-100, #fef3c7)"
                fg="var(--color-amber-700, #b45309)"
                icon={<AlertTriangle size={11} aria-hidden="true" />}
              >
                External
              </Badge>
            ) : null}
          </div>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {AUTOMATION_TYPE_LABELS[a.type]} · {a.scheduleLabel} · to {recipientsSummary(a.recipients)}
            {showOwner && a.ownerName !== null ? ` · ${a.ownerName}` : ''}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        <span className="inline-flex items-center gap-1">
          {a.isEventTrigger ? (
            <>
              <CalendarClock size={12} aria-hidden="true" />
              {a.status === 'active' ? 'Runs before each matching meeting' : a.status === 'paused' ? 'Paused' : 'Not active'}
            </>
          ) : (
            <>
              <Clock size={12} aria-hidden="true" />
              {a.nextRunAt !== null && a.status === 'active'
                ? `Next: ${formatDateTime(a.nextRunAt)}`
                : a.status === 'paused'
                  ? 'Next: paused'
                  : 'Next: —'}
            </>
          )}
        </span>
        <span>
          Last run:{' '}
          {a.lastRunAt !== null ? (
            <>
              {formatDateTime(a.lastRunAt)}
              {a.lastRunStatus !== null ? (
                <span style={{ color: RUN_STATUS_COLOR[a.lastRunStatus] ?? 'var(--text-secondary)', fontWeight: 600 }}>
                  {' '}
                  ({a.lastRunStatus})
                </span>
              ) : null}
            </>
          ) : (
            'never'
          )}
        </span>
      </div>

      {note !== null ? (
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{note}</span>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {a.status === 'pending_confirmation' ? (
            <>
              <Button size="sm" variant="primary" disabled={busy} icon={<Check size={14} />} onClick={(): void => void run(() => confirm())}>
                Confirm
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} icon={<X size={14} />} onClick={(): void => void run(cancel)}>
                Cancel
              </Button>
            </>
          ) : null}
          {a.status === 'active' || a.status === 'paused' ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} icon={<Play size={14} />} onClick={(): void => void run(runNow)}>
                Run now
              </Button>
              {a.status === 'active' ? (
                <Button size="sm" variant="ghost" disabled={busy} icon={<Pause size={14} />} onClick={(): void => void run(() => setPaused(true))}>
                  Pause
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} icon={<PlayCircle size={14} />} onClick={(): void => void run(() => setPaused(false))}>
                  Resume
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} icon={<Trash2 size={14} />} onClick={(): void => void run(remove)}>
                Delete
              </Button>
            </>
          ) : null}
          {a.status === 'cancelled' ? (
            <Button size="sm" variant="ghost" disabled={busy} icon={<Trash2 size={14} />} onClick={(): void => void run(remove)}>
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
