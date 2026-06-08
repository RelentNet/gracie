'use client';

import { use, useState } from 'react';
import type { ClientNote } from '@gracie/shared';

import {
  getClientById,
  getClientNotesByClient,
  getUserInitials,
  getUserName,
} from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatEasternDateTime } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ClientAvatar } from '@/components/ClientAvatar';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';

/**
 * Client tab 5 — Notes (docs/08 §9). Compose area (editors only) + chronological
 * feed (newest first) with author chip + timestamp. The compose Post action is
 * visual-only in Phase 1A/2 (no persistence); Phase 1B wires it to
 * `POST /api/clients/:id/notes`. Data via MOCK selectors.
 */
export default function ClientNotesPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { canEdit } = useAuth();
  const [draft, setDraft] = useState<string>('');

  const client = getClientById(clientId);
  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  const notes: readonly ClientNote[] = getClientNotesByClient(clientId)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      {canEdit() ? (
        <Card>
          <label htmlFor="note-compose" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            Add a note
          </label>
          <textarea
            id="note-compose"
            value={draft}
            onChange={(event): void => setDraft(event.target.value)}
            rows={3}
            placeholder="Share context about this client with the team…"
            className="mt-2 w-full resize-y rounded-lg border p-3"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
          />
          <div className="mt-3 flex justify-end">
            {/* Phase 1B: wire to POST /api/clients/:id/notes. Visual-only now. */}
            <Button variant="primary" disabled={draft.trim() === ''}>
              Post note
            </Button>
          </div>
        </Card>
      ) : null}

      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          description="Notes shared about this client will appear here, newest first."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <ClientAvatar
                    initials={getUserInitials(note.authorUserId)}
                    size="sm"
                    color="var(--color-blue-700)"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span style={TYPE.bodyStrong}>{getUserName(note.authorUserId)}</span>
                      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                        {formatEasternDateTime(note.createdAt)}
                      </span>
                    </span>
                    <p style={TYPE.body}>{note.content}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
