import type { CSSProperties, ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Labeled form-field primitives (P2.1). Thin wrappers over native
 * input/select/textarea styled to the design system, so the per-tab edit forms
 * stay consistent and terse. All are controlled; the caller owns the value.
 */
const CONTROL_CLASS = 'mt-1 w-full rounded-lg border p-2.5';
const CONTROL_STYLE: CSSProperties = { borderColor: 'var(--border-subtle)', ...TYPE.body };

function FieldLabel({ label, required }: { label: string; required?: boolean }): React.JSX.Element {
  return (
    <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
      {label}
      {required === true ? <span style={{ color: 'var(--color-red-600)' }}> *</span> : null}
    </span>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'email' | 'url' | 'number' | 'date';
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly min?: number;
  readonly id?: string;
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  required,
  min,
  id,
}: TextFieldProps): React.JSX.Element {
  return (
    <label className="block" htmlFor={id}>
      <FieldLabel label={label} required={required} />
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        onChange={(event): void => onChange(event.target.value)}
        className={CONTROL_CLASS}
        style={CONTROL_STYLE}
      />
    </label>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly disabled?: boolean;
  readonly id?: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  id,
}: SelectFieldProps): React.JSX.Element {
  return (
    <label className="block" htmlFor={id}>
      <FieldLabel label={label} />
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event): void => onChange(event.target.value)}
        className={CONTROL_CLASS}
        style={CONTROL_STYLE}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface TextAreaFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly rows?: number;
  readonly id?: string;
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  rows = 3,
  id,
}: TextAreaFieldProps): React.JSX.Element {
  return (
    <label className="block" htmlFor={id}>
      <FieldLabel label={label} />
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        onChange={(event): void => onChange(event.target.value)}
        className={`${CONTROL_CLASS} resize-y`}
        style={CONTROL_STYLE}
      />
    </label>
  );
}

/** Inline form-level error line (role=alert), used by the edit forms on save failure. */
export function FormError({ message }: { message: string | null }): ReactNode {
  if (message === null) return null;
  return (
    <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
      {message}
    </p>
  );
}
