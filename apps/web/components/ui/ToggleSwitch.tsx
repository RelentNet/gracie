import type React from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Small labelled switch used by the chat surfaces (Knowledge Base / Web toggles).
 * Presentational — the parent client component owns the state + `onChange`.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  icon,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon?: React.ReactNode;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <label
      className="flex items-center gap-2"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
    >
      {icon}
      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(): void => onChange(!checked)}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{
          backgroundColor: checked ? 'var(--color-blue-600)' : 'var(--color-slate-100)',
          border: '1px solid var(--border-subtle)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block size-4 rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: checked ? 'translateX(1rem)' : 'translateX(0.125rem)' }}
        />
      </button>
    </label>
  );
}
