'use client';

import { use } from 'react';
import { Send, Sparkles } from 'lucide-react';

import { getClientById } from '@/lib/mock';
import { TYPE } from '@/lib/typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/StateViews';

/**
 * Client tab 7 — Intelligence (docs/08 §9). Client-scoped AI chat. The chat
 * itself ships in Phase 6 (see docs/08 §8 M14); this is a styled placeholder
 * showing the scope bar and a disabled composer so the layout is reviewable.
 * Retrieval will be role-filtered (docs/06 §7); all AI access routes through the
 * provider interface (D11).
 */
export default function ClientIntelligencePage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const client = getClientById(clientId);

  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Scope bar */}
      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2">
          <Sparkles aria-hidden="true" size={16} style={{ color: 'var(--color-blue-700)' }} />
          <span style={TYPE.bodyStrong}>Scoped to {client.name}</span>
        </span>
        <Badge bg="var(--color-amber-100)" fg="var(--color-amber-600)">
          Coming in Phase 6
        </Badge>
      </Card>

      {/* Disabled chat surface */}
      <Card className="flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center">
        <Sparkles aria-hidden="true" size={28} style={{ color: 'var(--text-secondary)' }} />
        <p style={TYPE.sectionHeader}>Client Intelligence chat</p>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)', maxWidth: '32rem' }}>
          A client-scoped AI assistant with an online-research toggle and role-filtered
          retrieval will live here. This module is delivered in Phase 6.
        </p>
      </Card>

      {/* Disabled composer */}
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="sr-only">Message the assistant (disabled)</span>
          <textarea
            disabled
            rows={2}
            placeholder="Chat is available in Phase 6…"
            className="w-full resize-none rounded-lg border p-3"
            style={{
              borderColor: 'var(--border-subtle)',
              backgroundColor: 'var(--color-slate-100)',
              color: 'var(--text-secondary)',
              cursor: 'not-allowed',
              ...TYPE.body,
            }}
          />
        </label>
        <button
          type="button"
          disabled
          aria-label="Send message (disabled)"
          className="rounded-lg p-3 shadow-sm"
          style={{
            backgroundColor: 'var(--color-slate-100)',
            color: 'var(--text-secondary)',
            cursor: 'not-allowed',
          }}
        >
          <Send aria-hidden="true" size={18} />
        </button>
      </div>
    </div>
  );
}
