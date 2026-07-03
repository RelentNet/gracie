'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import type { Client } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Card } from '@/components/ui/Card';
import { ChatThread } from '@/components/chat/ChatThread';
import { ChatComposer } from '@/components/chat/ChatComposer';
import type { ChatMessage } from '@/components/chat/types';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Client tab 7 — Intelligence (docs/08 §9, docs/06 §7). A client-scoped AI chat:
 * the scope bar + a Knowledge Base toggle, a streaming chat thread (shared
 * `ChatThread`/`ChatComposer` — identical to the general Assistant), and a
 * composer where Enter sends and Shift+Enter inserts a newline. Retrieval is
 * role-filtered server-side (a Viewer/Standard never receives transcript-sourced
 * context, D14); all AI access routes through the provider interface (D11) via
 * `POST /api/ai/chat`.
 */
interface OverviewResponse {
  readonly client: Client;
}

export default function ClientIntelligencePage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);

  const [client, setClient] = useState<Client | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [includeKnowledgeBase, setIncludeKnowledgeBase] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idRef = useRef(0);

  useEffect(() => {
    let active = true;
    apiClient
      .get<OverviewResponse>(`/api/clients/${clientId}/overview`)
      .then((data) => {
        if (active) setClient(data.client);
      })
      .catch((e: unknown) => {
        if (active) setClientError(e instanceof Error ? e.message : 'Failed to load client');
      });
    return (): void => {
      active = false;
    };
  }, [clientId]);

  function nextId(): string {
    idRef.current += 1;
    return String(idRef.current);
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (text === '' || streaming) return;

    setError(null);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userMessage: ChatMessage = { id: nextId(), role: 'user', content: text };
    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, message: text, includeKnowledgeBase, history }),
      });
      if (!res.ok || res.body === null) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }

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
      // Drop the empty assistant placeholder on a failed turn.
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
    }
  }

  if (clientError !== null) {
    return <ErrorState title="Couldn’t load client" description={clientError} />;
  }
  if (client === null) {
    return <LoadingState label="Loading client…" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Scope bar + Knowledge Base toggle */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2">
          <Sparkles aria-hidden="true" size={16} style={{ color: 'var(--color-blue-700)' }} />
          <span style={TYPE.bodyStrong}>Scoped to {client.name}</span>
        </span>
        <label className="flex cursor-pointer items-center gap-2">
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Knowledge Base</span>
          <button
            type="button"
            role="switch"
            aria-checked={includeKnowledgeBase}
            aria-label="Include Knowledge Base in answers"
            onClick={(): void => setIncludeKnowledgeBase((v) => !v)}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
            style={{
              backgroundColor: includeKnowledgeBase
                ? 'var(--color-blue-600)'
                : 'var(--color-slate-100)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block size-4 rounded-full bg-white shadow-sm transition-transform"
              style={{ transform: includeKnowledgeBase ? 'translateX(1rem)' : 'translateX(0.125rem)' }}
            />
          </button>
        </label>
      </Card>

      {/* Chat thread */}
      <ChatThread
        messages={messages}
        streaming={streaming}
        className="max-h-[28rem] min-h-64"
        emptyState={
          <Card className="flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center">
            <Sparkles aria-hidden="true" size={28} style={{ color: 'var(--color-blue-700)' }} />
            <p style={TYPE.sectionHeader}>Ask about {client.name}</p>
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)', maxWidth: '32rem' }}>
              Answers are grounded in this client’s documents. Toggle the Knowledge Base to also
              draw on Grace &amp; Associates’ shared reference material.
            </p>
          </Card>
        }
      />

      {error !== null ? (
        <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
          {error}
        </p>
      ) : null}

      {/* Composer */}
      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={(): void => void send()}
        disabled={streaming}
        placeholder={`Ask about ${client.name}…  (Enter to send, Shift+Enter for a new line)`}
      />
    </div>
  );
}
