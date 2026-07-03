'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Archive, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { TYPE } from '@/lib/typography';
import { LoadingState } from '@/components/ui/StateViews';

/** Sidebar view of a conversation (a trimmed `assistant_chats` row). */
export interface Conversation {
  readonly id: string;
  readonly title: string | null;
  readonly archived: boolean;
  readonly updatedAt: string;
}

/**
 * Left pane of the Assistant: new-chat button, search, and the owner's
 * conversation list. Each row opens on click and reveals rename / archive / delete
 * actions. All data is the caller's own (the API enforces `user_id = self`).
 */
export function ConversationList({
  chats,
  activeChatId,
  loading,
  error,
  search,
  onSearchChange,
  onSelect,
  onNewChat,
  onRename,
  onArchive,
  onDelete,
}: {
  readonly chats: readonly Conversation[];
  readonly activeChatId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onNewChat: () => void;
  readonly onRename: (id: string, title: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onDelete: (id: string) => void;
}): React.JSX.Element {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function startRename(chat: Conversation): void {
    setRenamingId(chat.id);
    setRenameValue(chat.title ?? '');
  }

  function commitRename(id: string): void {
    const title = renameValue.trim();
    if (title !== '') onRename(id, title);
    setRenamingId(null);
  }

  function onRenameKeyDown(event: KeyboardEvent<HTMLInputElement>, id: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename(id);
    } else if (event.key === 'Escape') {
      setRenamingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 transition-shadow hover:shadow-md"
        style={{ backgroundColor: 'var(--color-blue-600)', color: '#ffffff', ...TYPE.bodyStrong }}
      >
        <Plus aria-hidden="true" size={16} />
        New chat
      </button>

      <label className="relative block">
        <span className="sr-only">Search conversations</span>
        <Search
          aria-hidden="true"
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-secondary)' }}
        />
        <input
          type="search"
          value={search}
          onChange={(event): void => onSearchChange(event.target.value)}
          placeholder="Search"
          className="w-full rounded-lg border py-2 pl-9 pr-3"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#ffffff', ...TYPE.secondary }}
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {loading ? (
          <LoadingState label="Loading conversations…" />
        ) : error !== null ? (
          <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </p>
        ) : chats.length === 0 ? (
          <p className="px-2 py-6 text-center" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {search.trim() === '' ? 'No conversations yet. Start a new chat.' : 'No matches.'}
          </p>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isRenaming = chat.id === renamingId;
            return (
              <div
                key={chat.id}
                className="group flex items-center gap-1 rounded-lg px-2 py-2 transition-colors"
                style={{ backgroundColor: isActive ? 'var(--color-slate-100)' : 'transparent' }}
              >
                {isRenaming ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event): void => setRenameValue(event.target.value)}
                      onKeyDown={(event): void => onRenameKeyDown(event, chat.id)}
                      className="min-w-0 flex-1 rounded border px-2 py-1"
                      style={{ borderColor: 'var(--border-subtle)', ...TYPE.secondary }}
                    />
                    <button
                      type="button"
                      onClick={(): void => commitRename(chat.id)}
                      aria-label="Save title"
                      style={{ color: 'var(--color-blue-700)' }}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(): void => setRenamingId(null)}
                      aria-label="Cancel rename"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={(): void => onSelect(chat.id)}
                      className="min-w-0 flex-1 truncate text-left"
                      style={{
                        ...TYPE.secondary,
                        fontWeight: isActive ? 600 : 400,
                        color: 'var(--text-primary)',
                      }}
                      title={chat.title ?? 'New conversation'}
                    >
                      {chat.title ?? 'New conversation'}
                    </button>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={(): void => startRename(chat)}
                        aria-label="Rename conversation"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(): void => onArchive(chat.id)}
                        aria-label="Archive conversation"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Archive size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(): void => onDelete(chat.id)}
                        aria-label="Delete conversation"
                        style={{ color: 'var(--color-red-500)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
