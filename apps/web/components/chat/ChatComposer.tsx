'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { Send } from 'lucide-react';

import { TYPE } from '@/lib/typography';

/**
 * Message composer shared by the Intelligence tab and the Assistant: a growable
 * textarea where Enter sends and Shift+Enter inserts a newline, plus a send
 * button. `leading` renders left of the textarea (e.g. the Assistant's attach
 * button); `children` renders above it (e.g. attachment chips).
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  leading,
  children,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  /** True while a response is streaming — blocks input + send. */
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly leading?: ReactNode;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const sendDisabled = disabled || value.trim() === '';

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {children}
      <div className="flex items-end gap-2">
        {leading}
        <label className="flex-1">
          <span className="sr-only">Message the assistant</span>
          <textarea
            value={value}
            onChange={(event): void => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full resize-none rounded-lg border p-3"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#ffffff', ...TYPE.body }}
          />
        </label>
        <button
          type="button"
          onClick={(): void => onSend()}
          disabled={sendDisabled}
          aria-label="Send message"
          className="rounded-lg p-3 shadow-sm transition-shadow hover:shadow-md"
          style={{
            backgroundColor: sendDisabled ? 'var(--color-slate-100)' : 'var(--color-blue-600)',
            color: sendDisabled ? 'var(--text-secondary)' : '#ffffff',
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          <Send aria-hidden="true" size={18} />
        </button>
      </div>
    </div>
  );
}
