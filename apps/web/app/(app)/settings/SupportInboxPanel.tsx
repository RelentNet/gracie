'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { supportCategoryLabel, type SupportRequestView } from '@/lib/support';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

/**
 * Settings → Support — every request staff filed from the Support tab, open first,
 * with the auto-captured context (page, version, browser, screen/zoom) and a
 * Mark done / Reopen action.
 */
export function SupportInboxPanel(): React.JSX.Element {
  const { productName } = useAuth();
  const [requests, setRequests] = useState<readonly SupportRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ requests: SupportRequestView[] }>('/api/support?scope=all');
      setRequests(res.requests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load support requests');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const setStatus = async (id: string, status: 'open' | 'done'): Promise<void> => {
    setBusyId(id);
    try {
      await apiClient.patch(`/api/support/${id}`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the request');
    } finally {
      setBusyId(null);
    }
  };

  if (error !== null && requests === null) return <ErrorState title="Couldn’t load support requests" description={error} />;
  if (requests === null) return <LoadingState label="Loading support requests…" />;
  if (requests.length === 0) {
    return <EmptyState title="No support requests" description="Requests staff send from the Support tab appear here." />;
  }

  const openCount = requests.filter((r) => r.status === 'open').length;
  return (
    <div className="flex flex-col gap-3">
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        {openCount} open · {requests.length - openCount} resolved
      </p>
      {requests.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2 p-4" style={{ opacity: r.status === 'done' ? 0.7 : 1 }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col">
              <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
                {r.userName ?? 'Unknown user'} — {supportCategoryLabel(r.category)}
              </span>
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {formatDateTime(r.createdAt)}
                {r.status === 'done' && r.resolvedAt !== null ? ` · resolved ${formatDateTime(r.resolvedAt)}` : ''}
              </span>
            </div>
            <Button
              size="sm"
              variant={r.status === 'done' ? 'ghost' : 'secondary'}
              disabled={busyId === r.id}
              onClick={(): void => void setStatus(r.id, r.status === 'done' ? 'open' : 'done')}
            >
              {r.status === 'done' ? 'Reopen' : 'Mark done'}
            </Button>
          </div>
          <p className="whitespace-pre-wrap" style={{ ...TYPE.body, color: 'var(--text-primary)' }}>
            {r.message}
          </p>
          <p className="break-words" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Page {r.pageUrl ?? '—'} · {productName} {r.appVersion ?? '—'} · {r.screen ?? '—'}
            <br />
            {r.browser ?? '—'}
          </p>
        </Card>
      ))}
    </div>
  );
}
