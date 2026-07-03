'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Paperclip, X } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Card } from '@/components/ui/Card';
import { ChatThread } from '@/components/chat/ChatThread';
import { ChatComposer } from '@/components/chat/ChatComposer';
import type { ChatMessage } from '@/components/chat/types';
import { LoadingState } from '@/components/ui/StateViews';
import { ConversationList, type Conversation } from './ConversationList';

/**
 * `/assistant` — the general AI Assistant (Module 14, docs/08 §M14). A ChatGPT-
 * style two-pane surface built from the SAME shared chat components as the client
 * Intelligence tab: left = the owner's conversations (search / new / rename /
 * archive / delete); right = a streaming thread with file-attach. All data is
 * strictly per-user — every API call is scoped to the caller server-side. AI is
 * streamed via the provider interface (D11); files are chat-scoped & ephemeral.
 */
interface StoredMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface PendingAttachment {
  readonly id: string;
  readonly fileName: string;
}

const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.csv,text/plain,application/pdf,text/csv';

export default function AssistantPage(): React.JSX.Element {
  const [chats, setChats] = useState<readonly Conversation[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<readonly PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const idRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function nextId(): string {
    idRef.current += 1;
    return `local-${idRef.current}`;
  }

  const loadChats = useCallback(async (searchValue: string): Promise<void> => {
    setChatsError(null);
    try {
      const query = searchValue.trim() === '' ? '' : `?search=${encodeURIComponent(searchValue.trim())}`;
      const data = await apiClient.get<{ chats: Conversation[] }>(`/api/assistant/chats${query}`);
      setChats(data.chats);
    } catch (e) {
      setChatsError(e instanceof Error ? e.message : 'Failed to load conversations');
    } finally {
      setChatsLoading(false);
    }
  }, []);

  // Initial load + debounced re-query as the search term changes.
  useEffect(() => {
    const handle = setTimeout(() => void loadChats(search), search === '' ? 0 : 250);
    return (): void => clearTimeout(handle);
  }, [search, loadChats]);

  function startNewChat(): void {
    setActiveChatId(null);
    setMessages([]);
    setInput('');
    setAttachments([]);
    setError(null);
  }

  async function selectChat(id: string): Promise<void> {
    if (id === activeChatId) return;
    setActiveChatId(id);
    setError(null);
    setAttachments([]);
    setMessages([]);
    setMessagesLoading(true);
    try {
      const data = await apiClient.get<{ messages: StoredMessage[] }>(`/api/assistant/chats/${id}`);
      setMessages(data.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversation');
    } finally {
      setMessagesLoading(false);
    }
  }

  async function uploadFile(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (activeChatId !== null) form.append('chatId', activeChatId);
      const res = await fetch('/api/assistant/attachments', { method: 'POST', body: form });
      const body = (await res.json().catch(() => null)) as
        | { attachment?: { id: string; fileName: string }; chatId?: string; error?: { message?: string } }
        | null;
      if (!res.ok || body?.attachment === undefined || body.chatId === undefined) {
        throw new Error(body?.error?.message ?? `Upload failed: ${res.status}`);
      }
      if (activeChatId === null) setActiveChatId(body.chatId);
      setAttachments((prev) => [...prev, { id: body.attachment!.id, fileName: body.attachment!.fileName }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file !== undefined) void uploadFile(file);
    event.target.value = '';
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (text === '' || streaming) return;

    setError(null);
    const attachmentIds = attachments.map((a) => a.id);
    const userMessage: ChatMessage = { id: nextId(), role: 'user', content: text };
    const assistantId = nextId();
    setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setAttachments([]);
    setStreaming(true);

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: activeChatId ?? undefined,
          message: text,
          attachmentIds,
        }),
      });
      if (!res.ok || res.body === null) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }

      const newChatId = res.headers.get('X-Chat-Id');
      if (activeChatId === null && newChatId !== null) setActiveChatId(newChatId);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk === '') continue;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get a response');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
      void loadChats(search); // refresh titles + recency ordering
    }
  }

  async function handleRename(id: string, title: string): Promise<void> {
    try {
      await apiClient.patch(`/api/assistant/chats/${id}`, { title });
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename conversation');
    }
  }

  async function handleArchive(id: string): Promise<void> {
    try {
      await apiClient.patch(`/api/assistant/chats/${id}`, { archived: true });
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeChatId === id) startNewChat();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive conversation');
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await apiClient.del(`/api/assistant/chats/${id}`);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeChatId === id) startNewChat();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete conversation');
    }
  }

  const attachDisabled = streaming || uploading;

  return (
    <div className="flex h-[calc(100dvh-4rem)] gap-4">
      <Card className="flex w-72 shrink-0 flex-col p-3">
        <ConversationList
          chats={chats}
          activeChatId={activeChatId}
          loading={chatsLoading}
          error={chatsError}
          search={search}
          onSearchChange={setSearch}
          onSelect={(id): void => void selectChat(id)}
          onNewChat={startNewChat}
          onRename={(id, title): void => void handleRename(id, title)}
          onArchive={(id): void => void handleArchive(id)}
          onDelete={(id): void => void handleDelete(id)}
        />
      </Card>

      <Card className="flex flex-1 flex-col gap-3 p-4">
        {messagesLoading ? (
          <div className="flex flex-1 items-center">
            <LoadingState label="Loading conversation…" />
          </div>
        ) : (
          <ChatThread
            messages={messages}
            streaming={streaming}
            emptyState={
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <MessageSquare aria-hidden="true" size={28} style={{ color: 'var(--color-blue-700)' }} />
                <p style={TYPE.sectionHeader}>How can I help?</p>
                <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)', maxWidth: '32rem' }}>
                  Ask anything — draft an email, summarize notes, or attach a file to ask about it.
                  Your conversations are private to you.
                </p>
              </div>
            }
          />
        )}

        {error !== null ? (
          <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </p>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          onChange={onFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={(): void => void send()}
          disabled={streaming}
          placeholder="Message the assistant…  (Enter to send, Shift+Enter for a new line)"
          leading={
            <button
              type="button"
              onClick={(): void => fileInputRef.current?.click()}
              disabled={attachDisabled}
              aria-label="Attach a file"
              className="rounded-lg border p-3 transition-colors"
              style={{
                borderColor: 'var(--border-subtle)',
                color: attachDisabled ? 'var(--text-secondary)' : 'var(--text-primary)',
                cursor: attachDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              <Paperclip aria-hidden="true" size={18} />
            </button>
          }
        >
          {(attachments.length > 0 || uploading) && (
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex items-center gap-1 rounded-md px-2 py-1"
                  style={{ backgroundColor: 'var(--color-slate-100)', ...TYPE.secondary }}
                >
                  <Paperclip aria-hidden="true" size={12} />
                  <span className="max-w-40 truncate">{attachment.fileName}</span>
                  <button
                    type="button"
                    onClick={(): void =>
                      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
                    }
                    aria-label={`Remove ${attachment.fileName}`}
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {uploading ? (
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Extracting…</span>
              ) : null}
            </div>
          )}
        </ChatComposer>
      </Card>
    </div>
  );
}
