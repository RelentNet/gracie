'use client';

import { use, useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { ClientNote } from '@gracie/shared';

import { getUserInitials, getUserName } from '@/lib/mock';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ClientAvatar } from '@/components/ClientAvatar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Client tab 5 — Notes (docs/08 §9). Compose area (editors only) + chronological
 * feed (newest first) with author chip + timestamp. Editors add notes via
 * `POST /api/clients/:id/notes`; the author (or an admin) can edit/delete each note
 * (`PATCH`/`DELETE …/:noteId`). User names/initials still resolve through the mock
 * display lookup (users module not yet wired).
 */
interface NotesResponse {
  readonly notes: readonly ClientNote[];
}

interface NoteResponse {
  readonly note: ClientNote;
}

export default function ClientNotesPage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { canEdit } = useAuth();
  const editable = canEdit();

  const [draft, setDraft] = useState<string>('');
  const [posting, setPosting] = useState<boolean>(false);
  const [postError, setPostError] = useState<string | null>(null);

  const [notes, setNotes] = useState<readonly ClientNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<NotesResponse>(`/api/clients/${clientId}/notes`)
      .then((result) => {
        if (active) setNotes(result.notes);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load notes');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  async function postNote(): Promise<void> {
    const content = draft.trim();
    if (content === '' || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const { note } = await apiClient.post<NoteResponse>(`/api/clients/${clientId}/notes`, {
        content,
      });
      setNotes((prev) => [note, ...(prev ?? [])]);
      setDraft('');
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post note');
    } finally {
      setPosting(false);
    }
  }

  if (error !== null) {
    return <ErrorState title="Couldn’t load notes" description={error} />;
  }

  if (notes === null) {
    return <LoadingState label="Loading notes…" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {editable ? (
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
          {postError !== null ? (
            <p role="alert" className="mt-2" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
              {postError}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={draft.trim() === '' || posting} onClick={(): void => void postNote()}>
              {posting ? 'Posting…' : 'Post note'}
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
              <NoteRow
                clientId={clientId}
                note={note}
                editable={editable}
                onChanged={(updated): void =>
                  setNotes((prev) => (prev ?? []).map((n) => (n.id === updated.id ? updated : n)))
                }
                onDeleted={(id): void => setNotes((prev) => (prev ?? []).filter((n) => n.id !== id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({
  clientId,
  note,
  editable,
  onChanged,
  onDeleted,
}: {
  readonly clientId: string;
  readonly note: ClientNote;
  readonly editable: boolean;
  readonly onChanged: (note: ClientNote) => void;
  readonly onDeleted: (id: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(note.content);
  const [busy, setBusy] = useState<boolean>(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const content = draft.trim();
    if (content === '' || busy) return;
    setBusy(true);
    setRowError(null);
    try {
      const { note: updated } = await apiClient.patch<NoteResponse>(
        `/api/clients/${clientId}/notes/${note.id}`,
        { content },
      );
      onChanged(updated);
      setEditing(false);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (busy || !window.confirm('Delete this note?')) return;
    setBusy(true);
    setRowError(null);
    try {
      await apiClient.del(`/api/clients/${clientId}/notes/${note.id}`);
      onDeleted(note.id);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Failed to delete');
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <ClientAvatar
          initials={getUserInitials(note.authorUserId)}
          size="sm"
          color="var(--color-blue-700)"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span style={TYPE.bodyStrong}>{getUserName(note.authorUserId)}</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              {formatDateTime(note.createdAt)}
            </span>
          </span>
          {editing ? (
            <div className="mt-1 flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(event): void => setDraft(event.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border p-2.5"
                style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
              />
              {rowError !== null ? (
                <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
                  {rowError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={(): void => {
                    setEditing(false);
                    setDraft(note.content);
                    setRowError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="primary" size="sm" disabled={busy || draft.trim() === ''} onClick={(): void => void save()}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <p style={TYPE.body}>{note.content}</p>
          )}
          {!editing && rowError !== null ? (
            <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
              {rowError}
            </p>
          ) : null}
        </div>
        {editable && !editing ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label="Edit note"
              disabled={busy}
              onClick={(): void => setEditing(true)}
              className="rounded-md p-1.5"
              style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
            <button
              type="button"
              aria-label="Delete note"
              disabled={busy}
              onClick={(): void => void remove()}
              className="rounded-md p-1.5"
              style={{ color: 'var(--color-red-600)', background: 'transparent', cursor: 'pointer' }}
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
