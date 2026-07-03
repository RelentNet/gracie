'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { ChatBubble } from './ChatBubble';
import type { ChatMessage } from './types';

/**
 * Scrollable message thread shared by the Intelligence tab and the Assistant. Auto
 * -scrolls to the newest content as tokens stream in; renders `emptyState` when
 * there are no messages. `className` lets each host size the thread (a bounded
 * height inside the client tab, `flex-1` in the full-page Assistant).
 *
 * No `aria-live` here: the thread mutates on every streamed token, which would
 * flood a screen reader — the composer status + error alerts cover state instead.
 */
export function ChatThread({
  messages,
  streaming,
  emptyState,
  className = 'flex-1 min-h-0',
}: {
  readonly messages: readonly ChatMessage[];
  readonly streaming: boolean;
  readonly emptyState: ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  if (messages.length === 0) {
    return <div className={`flex flex-col ${className}`}>{emptyState}</div>;
  }

  return (
    <div ref={threadRef} className={`flex flex-col gap-3 overflow-y-auto ${className}`}>
      {messages.map((message) => (
        <ChatBubble key={message.id} message={message} streaming={streaming} />
      ))}
    </div>
  );
}
