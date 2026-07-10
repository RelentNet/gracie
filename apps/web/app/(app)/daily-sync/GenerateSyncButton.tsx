'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TYPE } from '@/lib/typography';

/**
 * Admin-only "Generate now" control for the Daily Sync page (P7 §6). Enqueues a
 * manual daily-sync run (bypasses the 6 AM ET gate) and refreshes the page after a
 * short delay so the freshly-written row appears. Mirrors the calendar "Sync now".
 */
export function GenerateSyncButton(): React.JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setIsError(false);
    try {
      const res = await fetch('/api/daily-sync/run', { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? `Request failed (${res.status})`);
      }
      setMessage('Generating… this refreshes shortly.');
      // The worker writes the row asynchronously; give it a moment, then refresh.
      setTimeout(() => startTransition(() => router.refresh()), 4000);
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : 'Could not start the sync.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        icon={<RefreshCw size={14} aria-hidden="true" />}
        disabled={busy || pending}
        onClick={(): void => void run()}
      >
        {busy || pending ? 'Generating…' : 'Generate now'}
      </Button>
      {message !== null ? (
        <span
          role={isError ? 'alert' : 'status'}
          style={{ ...TYPE.secondary, color: isError ? 'var(--color-red-500)' : 'var(--text-secondary)' }}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
