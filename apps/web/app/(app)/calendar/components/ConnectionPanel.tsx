'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CalendarConnectionStatus } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';

import type {
  AutoJoinResponse,
  CalendarSettingsResponse,
  ConnectionsResponse,
  ManualJoinStateResponse,
} from '../types';

export function ConnectionPanel({
  isAdmin,
  onSynced,
  manualJoinEnabled,
  onManualJoinChanged,
}: {
  readonly isAdmin: boolean;
  readonly onSynced?: () => void;
  /** On-demand-join master switch (P4.2); null until loaded. */
  readonly manualJoinEnabled: boolean | null;
  /** Notify the page when an Admin flips the master switch (updates the toolbar). */
  readonly onManualJoinChanged: (enabled: boolean) => void;
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
                  style={{ backgroundColor: member.isConnected ? 'var(--color-emerald-500)' : 'var(--color-slate-500)' }}
                />
                <span className="flex min-w-0 flex-col">
                  <span style={TYPE.bodyStrong} className="truncate">
                    {member.name}
                  </span>
                  <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }} className="truncate">
                    {member.email}
                  </span>
                </span>
                <span
                  className="ml-auto"
                  style={{ ...TYPE.label, color: member.isConnected ? 'var(--color-emerald-600)' : 'var(--text-secondary)' }}
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
          {isAdmin ? <BotDispatchToggle /> : null}
          {isAdmin ? (
            <ManualJoinToggle enabled={manualJoinEnabled} onChanged={onManualJoinChanged} />
          ) : null}
          <AutoJoinToggle />
        </div>
      )}
    </Card>
  );
}

/**
 * Admin-only master switch for on-demand meeting join (P4.2). INDEPENDENT of the
 * auto-dispatch kill-switch above: this governs the explicit "paste a link →
 * Gracie joins now" action, not the automatic calendar cron. Fail-safe OFF.
 * Controlled by the page so flipping it shows/hides the toolbar control at once.
 */
function ManualJoinToggle({
  enabled,
  onChanged,
}: {
  readonly enabled: boolean | null;
  readonly onChanged: (enabled: boolean) => void;
}): React.JSX.Element {
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  const onToggle = useCallback(
    (next: boolean): void => {
      setSaving(true);
      setNote(null);
      apiClient
        .patch<ManualJoinStateResponse>('/api/calendar/manual-join', { enabled: next })
        .then((data) => onChanged(data.enabled))
        .catch((e: unknown) => setNote(e instanceof Error ? e.message : 'Could not save setting'))
        .finally(() => setSaving(false));
    },
    [onChanged],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>On-demand meeting join</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        When on, staff can paste a meeting link and have Gracie join and record it immediately.
        Independent of the auto-join switch — this is an explicit, per-meeting action.
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Admin-only master switch for the P4 meeting bot. When off, the worker joins
 * NO meetings team-wide, regardless of anyone's per-user preference — the global
 * kill-switch (fail-safe OFF by default). Non-admins never see this control.
 */
function BotDispatchToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<CalendarSettingsResponse>('/api/calendar/settings')
      .then((data) => {
        if (active) setEnabled(data.botDispatchEnabled);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const onToggle = useCallback(
    (next: boolean): void => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setNote(null);
      apiClient
        .patch<CalendarSettingsResponse>('/api/calendar/settings', { enabled: next })
        .then((data) => setEnabled(data.botDispatchEnabled))
        .catch((e: unknown) => {
          setEnabled(previous);
          setNote(e instanceof Error ? e.message : 'Could not save setting');
        })
        .finally(() => setSaving(false));
    },
    [enabled],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>Auto-join meetings (global)</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        Master switch for the whole team. When off, the meeting bot won’t join any
        meeting, regardless of per-user settings.
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function AutoJoinToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<AutoJoinResponse>('/api/calendar/auto-join')
      .then((data) => {
        if (active) setEnabled(data.autoJoinMeetings);
      })
      .catch(() => {
        if (active) setEnabled(true);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const onToggle = useCallback(
    (next: boolean): void => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setNote(null);
      apiClient
        .patch<AutoJoinResponse>('/api/calendar/auto-join', { enabled: next })
        .then((data) => setEnabled(data.autoJoinMeetings))
        .catch((e: unknown) => {
          setEnabled(previous);
          setNote(e instanceof Error ? e.message : 'Could not save preference');
        })
        .finally(() => setSaving(false));
    },
    [enabled],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? true}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>Auto-join meetings I lead</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        When off, the meeting bot won’t auto-join meetings where you’re the lead.
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
