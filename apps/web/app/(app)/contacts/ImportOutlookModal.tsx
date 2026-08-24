'use client';

import { useEffect, useRef, useState } from 'react';
import type { CalendarConnectionStatus } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextField } from '@/components/ui/Field';

/**
 * Import-from-Outlook modal (admin-only). Pick a connected mailbox (or type one),
 * enqueue the import, then poll the job for a plain-language result. The worker
 * pulls that mailbox's Outlook contacts via MS Graph and upserts them (deduped by
 * email). If Microsoft hasn't granted `Contacts.Read` yet the job comes back with a
 * clear "an Azure admin must add the permission" message rather than failing silently.
 */
interface ImportOutlookModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Called after a successful import so the list refreshes. */
  readonly onImported: () => void;
}

/** Mirrors the worker's `ImportOutlookContactsResult` (loosely typed on the client). */
interface ImportResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly imported?: number;
  readonly updated?: number;
  readonly skipped?: number;
  readonly affiliated?: number;
  readonly errors?: number;
}

interface JobStatus {
  readonly state: string;
  readonly result: ImportResult | null;
  readonly failedReason: string | null;
}

const POLL_MS = 1500;
const MAX_POLLS = 80; // ~2 min ceiling before we stop polling

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Turn a completed job result into a plain-language sentence. */
function describeResult(r: ImportResult): { message: string; tone: 'ok' | 'warn' } {
  if (r.ok) {
    const parts = [
      `Imported ${r.imported ?? 0} new contact${r.imported === 1 ? '' : 's'}`,
      `updated ${r.updated ?? 0}`,
      `skipped ${r.skipped ?? 0}`,
    ];
    let msg = `${parts.join(', ')}.`;
    if ((r.affiliated ?? 0) > 0) msg += ` Linked ${r.affiliated} to an existing organization.`;
    if ((r.errors ?? 0) > 0) msg += ` ${r.errors} record${r.errors === 1 ? '' : 's'} couldn’t be read.`;
    return { message: msg, tone: 'ok' };
  }
  switch (r.reason) {
    case 'not_consented':
      return {
        message:
          'This person hasn’t allowed contact import. Ask them to turn it on under My Settings, or enable it for them in Settings → Contacts.',
        tone: 'warn',
      };
    case 'permission_denied':
      return {
        message:
          'Microsoft hasn’t granted contact access yet — an Azure admin must add the Contacts.Read permission to the app.',
        tone: 'warn',
      };
    case 'mailbox_not_found':
      return { message: 'That mailbox wasn’t found, or Gracie isn’t allowed to read it.', tone: 'warn' };
    case 'graph_not_configured':
      return { message: 'Microsoft 365 isn’t connected yet.', tone: 'warn' };
    case 'no_mailbox':
      return { message: 'Please enter a mailbox to import from.', tone: 'warn' };
    default:
      return { message: 'Couldn’t read that mailbox from Microsoft. Please try again.', tone: 'warn' };
  }
}

export function ImportOutlookModal({
  isOpen,
  onClose,
  onImported,
}: ImportOutlookModalProps): React.JSX.Element {
  const [mailbox, setMailbox] = useState('');
  const [connected, setConnected] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ message: string; tone: 'ok' | 'warn' } | null>(null);
  const cancelled = useRef(false);

  // Load connected mailboxes for the picker + default to the first one.
  useEffect(() => {
    if (!isOpen) return;
    cancelled.current = false;
    setError(null);
    setOutcome(null);
    setBusy(false);
    apiClient
      .get<{ status: CalendarConnectionStatus }>('/api/calendar/connections')
      .then(({ status }) => {
        if (cancelled.current) return;
        const emails = status.members.filter((m) => m.isConnected).map((m) => m.email);
        setConnected(emails);
        setMailbox((cur) => (cur !== '' ? cur : (emails[0] ?? '')));
      })
      .catch(() => {
        /* picker is optional — the text input still works */
      });
    return (): void => {
      cancelled.current = true;
    };
  }, [isOpen]);

  function close(): void {
    cancelled.current = true;
    setMailbox('');
    setConnected([]);
    setError(null);
    setOutcome(null);
    setBusy(false);
    onClose();
  }

  async function runImport(): Promise<void> {
    const mb = mailbox.trim();
    if (mb === '' || !mb.includes('@')) {
      setError('Enter a mailbox email address (e.g. joe@graceandassociates.com).');
      return;
    }
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const post = await apiClient.post<{ jobId?: string; result?: ImportResult }>(
        '/api/contacts/import',
        { mailbox: mb },
      );
      // A rejection before enqueue (e.g. mailbox not consented) comes back inline
      // with no job — show it and stop, nothing to poll.
      if (post.result !== undefined) {
        setOutcome(describeResult(post.result));
        setBusy(false);
        return;
      }
      const jobId = post.jobId ?? '';
      // Poll until the worker finishes (or fails).
      for (let i = 0; i < MAX_POLLS && !cancelled.current; i += 1) {
        await sleep(POLL_MS);
        if (cancelled.current) return;
        const status = await apiClient.get<JobStatus>(`/api/contacts/import?jobId=${encodeURIComponent(jobId)}`);
        if (status.state === 'completed' && status.result !== null) {
          const described = describeResult(status.result);
          setOutcome(described);
          if (status.result.ok) onImported();
          setBusy(false);
          return;
        }
        if (status.state === 'failed') {
          setError(status.failedReason ?? 'The import failed. Please try again.');
          setBusy(false);
          return;
        }
      }
      if (!cancelled.current) {
        setOutcome({
          message: 'Still importing — this is taking a while. Check the contacts list in a minute.',
          tone: 'warn',
        });
        setBusy(false);
      }
    } catch (e) {
      if (!cancelled.current) {
        setError(e instanceof Error ? e.message : 'Failed to start the import.');
        setBusy(false);
      }
    }
  }

  const mailboxOptions =
    connected.length > 0
      ? [
          ...connected.map((e) => ({ value: e, label: e })),
          ...(mailbox !== '' && !connected.includes(mailbox)
            ? [{ value: mailbox, label: `${mailbox} (typed)` }]
            : []),
        ]
      : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Import from Outlook"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {outcome !== null ? 'Close' : 'Cancel'}
          </Button>
          <Button variant="primary" onClick={() => void runImport()} disabled={busy}>
            {busy ? 'Importing…' : 'Import contacts'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Pull a colleague’s Outlook / Office 365 contacts into Gracie. Existing contacts (matched by
          email) are updated, not duplicated, so this is safe to run again.
        </p>

        {connected.length > 0 ? (
          <SelectField
            label="Mailbox to import from"
            value={mailbox}
            onChange={setMailbox}
            options={mailboxOptions}
            disabled={busy}
          />
        ) : (
          <TextField
            label="Mailbox to import from"
            type="email"
            value={mailbox}
            onChange={setMailbox}
            placeholder="joe@graceandassociates.com"
            disabled={busy}
          />
        )}

        {outcome !== null ? (
          <p
            style={{
              ...TYPE.body,
              color: outcome.tone === 'ok' ? 'var(--text-primary)' : 'var(--color-amber-700, #b45309)',
            }}
          >
            {outcome.message}
          </p>
        ) : null}

        <FormError message={error} />
      </div>
    </Modal>
  );
}
