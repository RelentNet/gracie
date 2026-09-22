'use client';

import { useCallback, useState } from 'react';
import { LogOut, Pause, Play } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

/**
 * MeetingBotControls — live controls for an in-session meeting that has an assistant bot
 * (meeting page, in-session block). Two pure Recall bot-API actions, INDEPENDENT of
 * the transcript-provider / realtime setting:
 *   - Remove the assistant — the bot leaves the call. Irreversible (it won't rejoin), so it
 *     takes an inline confirm.
 *   - Pause ⇄ Resume — a manual recording toggle. While paused, a loud persistent
 *     banner makes it impossible to silently leave paused. No timer/auto-resume — a
 *     human at the dashboard clicks Resume.
 *
 * Paused state is tracked client-side (optimistic, rolled back if the call fails);
 * the page assumes recording on load (no schema change). Available to any staffer,
 * matching the per-meeting re-dispatch action.
 */
const NETWORK_ERROR = "Couldn't reach the assistant — try again.";

export function MeetingBotControls({ meetingId }: { readonly meetingId: string }): React.JSX.Element {
  const { productName } = useAuth();
  const [paused, setPaused] = useState(false);
  const [left, setLeft] = useState(false);
  const [busy, setBusy] = useState<'pause' | 'leave' | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (action: 'leave' | 'pause' | 'resume'): Promise<boolean> => {
      setError(null);
      try {
        await apiClient.post(`/api/meetings/${meetingId}/${action}`);
        return true;
      } catch {
        setError(NETWORK_ERROR);
        return false;
      }
    },
    [meetingId],
  );

  const togglePause = useCallback((): void => {
    const next = !paused;
    setBusy('pause');
    setPaused(next); // optimistic
    void call(next ? 'pause' : 'resume').then((ok) => {
      if (!ok) setPaused(!next); // roll back on failure
      setBusy(null);
    });
  }, [paused, call]);

  const leave = useCallback((): void => {
    setBusy('leave');
    void call('leave').then((ok) => {
      if (ok) setLeft(true);
      setConfirmLeave(false);
      setBusy(null);
    });
  }, [call]);

  if (left) {
    return (
      <p className="mt-3" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        {productName} has left this meeting. It won’t rejoin.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {paused ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          style={{
            backgroundColor: 'var(--color-amber-100)',
            borderColor: 'var(--color-amber-600)',
            color: 'var(--color-amber-600)',
          }}
        >
          <span style={TYPE.bodyStrong}>
            ⏸ Recording is paused — {productName} is not capturing this meeting.
          </span>
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={13} aria-hidden="true" />}
            disabled={busy !== null}
            onClick={togglePause}
          >
            Resume recording
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          disabled={busy !== null}
          onClick={togglePause}
        >
          {busy === 'pause' ? 'Working…' : paused ? 'Resume recording' : 'Pause recording'}
        </Button>

        {confirmLeave ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span style={TYPE.body}>Remove {productName}? It won’t rejoin.</span>
            <Button size="sm" variant="danger" disabled={busy !== null} onClick={leave}>
              {busy === 'leave' ? 'Removing…' : 'Yes, remove'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={(): void => setConfirmLeave(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut size={13} aria-hidden="true" />}
            disabled={busy !== null}
            onClick={(): void => setConfirmLeave(true)}
          >
            Remove {productName} from this meeting
          </Button>
        )}
      </div>

      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
