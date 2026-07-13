import { Markdown } from '@/components/ui/Markdown';
import { TYPE } from '@/lib/typography';

import { ConfirmActionCard } from './ConfirmActionCard';
import type { ChatMessage } from './types';

/**
 * One chat bubble — AI left (slate-100, Markdown), user right (blue-600). A blank
 * assistant bubble while `streaming` shows an animated typing indicator. Shared by
 * the Intelligence tab and the Assistant so both render answers identically. When an
 * assistant message carries a pending `action` (P8), a Confirm/Cancel card renders
 * below its text.
 */
export function ChatBubble({
  message,
  streaming,
}: {
  readonly message: ChatMessage;
  readonly streaming: boolean;
}): React.JSX.Element {
  const isUser = message.role === 'user';
  const isStreamingPlaceholder = !isUser && streaming && message.content === '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] rounded-lg px-4 py-3"
        style={{
          backgroundColor: isUser ? 'var(--color-blue-600)' : 'var(--color-slate-100)',
          color: isUser ? '#ffffff' : 'var(--text-primary)',
        }}
      >
        {isUser ? (
          <p style={{ ...TYPE.body, whiteSpace: 'pre-wrap' }}>{message.content}</p>
        ) : isStreamingPlaceholder ? (
          <span
            aria-label="Assistant is typing"
            className="inline-flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="size-1.5 animate-bounce rounded-full bg-current" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0.3s]" />
          </span>
        ) : (
          <>
            <Markdown content={message.content} />
            {message.action !== undefined ? <ConfirmActionCard action={message.action} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
