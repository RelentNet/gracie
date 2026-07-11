'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarClock, Check, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TYPE } from '@/lib/typography';
import type { AutomationProposal } from '@/lib/assistant/actions/proposal';

/**
 * The confirm-before-acting card (P8 §2a/§5). Gracie's create_automation tool only
 * PROPOSES — it persists a `pending_confirmation` automation and returns this
 * proposal. Activating it is a deliberate click here, which calls the SEPARATE,
 * permission-gated /confirm route (the LLM never activates anything).
 *
 * External (client_send) proposals require a genuine SECOND confirmation: the first
 * Confirm reveals a warning + an explicit "email the client" button, and the route
 * additionally enforces admin + the master switch + audit.
 */
type CardState = 'idle' | 'working' | 'confirmed' | 'cancelled';

export function ConfirmActionCard({ action }: { readonly action: AutomationProposal }): React.JSX.Element {
  const [state, setState] = useState<CardState>('idle');
  const [externalPrompt, setExternalPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doConfirm(confirmExternal: boolean): Promise<void> {
    setState('working');
    setError(null);
    try {
      const res = await fetch(`/api/automations/${action.automationId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmExternal ? { confirmExternal: true } : {}),
      });
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!res.ok) {
        // The route asks for the extra external confirmation — reveal the warning step.
        if (body?.error?.code === 'external_confirmation_required') {
          setExternalPrompt(true);
          setState('idle');
          return;
        }
        setError(body?.error?.message ?? 'Could not confirm this automation.');
        setState('idle');
        return;
      }
      setState('confirmed');
    } catch {
      setError('Could not reach the server. Please try again.');
      setState('idle');
    }
  }

  function onConfirmClick(): void {
    // External proposals: first click shows the warning; the second (explicit) click confirms.
    if (action.external && !externalPrompt) {
      setExternalPrompt(true);
      return;
    }
    void doConfirm(action.external);
  }

  async function onCancel(): Promise<void> {
    setState('working');
    setError(null);
    try {
      const res = await fetch(`/api/automations/${action.automationId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? 'Could not cancel.');
        setState('idle');
        return;
      }
      setState('cancelled');
    } catch {
      setError('Could not reach the server. Please try again.');
      setState('idle');
    }
  }

  const busy = state === 'working';

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-lg border p-3"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#ffffff' }}
    >
      <div className="flex items-center gap-2">
        <CalendarClock size={15} aria-hidden="true" style={{ color: 'var(--color-blue-700)' }} />
        <span style={TYPE.bodyStrong}>{action.title}</span>
      </div>
      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        {action.typeLabel} · {action.scheduleLabel} · to {action.recipientsSummary}
      </span>

      {action.external ? (
        <div
          className="flex items-start gap-2 rounded-md p-2"
          style={{ backgroundColor: 'var(--color-amber-50, #fffbeb)' }}
        >
          <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--color-amber-700, #b45309)', marginTop: 2 }} />
          <span style={{ ...TYPE.label, color: 'var(--text-primary)' }}>
            This emails a client directly. An admin must have external sending enabled, and only an admin
            can approve it.
          </span>
        </div>
      ) : null}

      {state === 'confirmed' ? (
        <span className="inline-flex items-center gap-1" style={{ ...TYPE.secondary, color: 'var(--color-emerald-700, #047857)' }}>
          <Check size={14} aria-hidden="true" /> Confirmed — manage it under Automations.
        </span>
      ) : state === 'cancelled' ? (
        <span className="inline-flex items-center gap-1" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          <X size={14} aria-hidden="true" /> Cancelled — nothing was scheduled.
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={action.external && externalPrompt ? 'danger' : 'primary'}
            disabled={busy}
            icon={<Check size={14} />}
            onClick={onConfirmClick}
          >
            {action.external ? (externalPrompt ? 'Yes, email the client' : 'Confirm') : 'Confirm & activate'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} icon={<X size={14} />} onClick={(): void => void onCancel()}>
            Not now
          </Button>
        </div>
      )}

      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
