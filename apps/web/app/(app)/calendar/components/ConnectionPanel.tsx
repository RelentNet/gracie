'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CalendarConnectionStatus } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { SettingToggle } from '@/components/ui/SettingToggle';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';

import type { ConnectionsResponse } from '../types';

/**
 * Calendar connection panel: Sync-now, the team member roster, and the per-user
 * "auto-join meetings I lead" preference. The two admin master switches (global
 * bot kill-switch + on-demand-join) moved to Settings → Meeting Bot; this panel
 * keeps only the personal preference.
 */
export function ConnectionPanel({
  isAdmin,
  onSynced,
}: {
  readonly isAdmin: boolean;
  readonly onSynced?: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ConnectionsResponse>('/api/calendar/connections')
      .then((data) => {
        if (active) setStatus(data.status);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load connection status');
      });
    return (): void => {
      active = false;
    };
  }, []);

  /** Re-fetch connection status; returns the fresh last-synced time. */
  const refreshStatus = useCallback(async (): Promise<string | null> => {
    const data = await apiClient.get<ConnectionsResponse>('/api/calendar/connections');
    setStatus(data.status);
    return data.status.lastSyncedAt;
  }, []);

  /**
   * Trigger a manual scan, then poll until the worker's last-synced time advances
   * (or a ~30s timeout), so the panel + calendar reflect the fresh sweep.
   */
  const onSyncNow = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setSyncNote(null);
    const before = status?.lastSyncedAt ?? null;
    try {
      await apiClient.post('/api/calendar/sync', {});
    } catch (e: unknown) {
      setSyncNote(e instanceof Error ? e.message : 'Could not start sync');
      setSyncing(false);
      return;
    }
    let done = false;
    for (let i = 0; i < 10 && !done; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      try {
        const after = await refreshStatus();
        if (after !== before) done = true;
      } catch {
        // transient — keep polling until the timeout
      }
    }
    setSyncNote(done ? 'Calendar synced.' : 'Sync started — results will appear shortly.');
    if (done) onSynced?.();
    setSyncing(false);
  }, [status, refreshStatus, onSynced]);

  return (
    <Card>
      <CardHeader
        title="Calendar Connection"
        description={
          status === null
            ? undefined
            : status.groupConfigured
              ? status.lastSyncedAt !== null
                ? `Last synced ${formatDateTime(status.lastSyncedAt)}`
                : 'Connected'
              : 'Not yet synced'
        }
      />
      {error !== null ? (
        <ErrorState title="Couldn’t load connections" description={error} />
      ) : status === null ? (
        <LoadingState label="Loading connection status…" />
      ) : (
        <div className="flex flex-col gap-3">
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={syncing}
                onClick={(): void => {
                  void onSyncNow();
                }}
                icon={
                  <RefreshCw
                    size={14}
                    aria-hidden="true"
                    className={syncing ? 'animate-spin' : undefined}
                  />
                }
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
              {syncNote !== null ? (
                <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{syncNote}</span>
              ) : null}
            </div>
          ) : null}
          {!status.groupConfigured ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              The calendar scan has not run yet. Connection status appears once the worker syncs
              access-group membership.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {status.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: member.isConnected
                      ? 'var(--color-emerald-500)'
                      : 'var(--color-slate-500)',
                  }}
                />
                <span className="flex min-w-0 flex-col">
                  <span style={TYPE.bodyStrong} className="truncate">
                    {member.name}
                  </span>
                  <span
                    style={{ ...TYPE.label, color: 'var(--text-secondary)' }}
                    className="truncate"
                  >
                    {member.email}
                  </span>
                </span>
                <span
                  className="ml-auto"
                  style={{
                    ...TYPE.label,
                    color: member.isConnected
                      ? 'var(--color-emerald-600)'
                      : 'var(--text-secondary)',
                  }}
                >
                  {member.isConnected ? 'Connected' : 'Offline'}
                </span>
              </li>
            ))}
          </ul>
          {isAdmin ? null : (
            <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              You see your own connection status. Admins see the whole team.
            </p>
          )}
          <SettingToggle
            getUrl="/api/calendar/auto-join"
            patchUrl="/api/calendar/auto-join"
            responseKey="autoJoinMeetings"
            defaultValue
            label="Auto-join meetings I lead"
            description="When off, the meeting bot won’t auto-join meetings where you’re the lead."
          />
        </div>
      )}
    </Card>
  );
}
