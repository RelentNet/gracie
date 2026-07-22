'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';

import type { AutomationRequestClientView } from './types';

/**
 * Admin "advanced requests" inbox (P8 §6). Lists the out-of-catalog automation
 * asks Gracie flagged for a human (things she can't build yet), each with
 * Accept/Dismiss. "Accept" records intent to build it; "Dismiss" closes it. Only
 * rendered for admins.
 */
export function AdvancedRequestsPanel(): React.JSX.Element {
  const [requests, setRequests] = useState<AutomationRequestClientView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetch('/api/automations/requests?status=pending', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load requests (${res.status})`);
      const data = (await res.json()) as { requests: AutomationRequestClientView[] };
      setRequests(data.requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load requests');
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, status: 'accepted' | 'dismissed'): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/automations/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? 'Failed to update request');
      }
      setRequests((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update request');
    } finally {
      setBusyId(null);
    }
  }

  if (requests === null) return <LoadingState label="Loading requests…" />;

  return (
    <div className="flex flex-col gap-3">
      {error !== null ? (
        <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
          {error}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <div className="flex items-center gap-2" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          <Inbox size={16} aria-hidden="true" />
          No advanced requests right now. When Gracie is asked for something she can&rsquo;t build yet, it appears here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border p-3"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <p style={TYPE.body}>{r.intent}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                  {r.requestedByName ?? 'A teammate'} · {formatDateTime(r.createdAt)}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === r.id}
                    onClick={(): void => void resolve(r.id, 'accepted')}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === r.id}
                    onClick={(): void => void resolve(r.id, 'dismissed')}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
