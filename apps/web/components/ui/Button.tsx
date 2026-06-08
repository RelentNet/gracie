import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Button — generic action primitive (docs/08 §4: `rounded-lg`, `shadow-sm`,
 * hover `shadow-md`). Always a real `<button>` for actions (docs/08 §11). Three
 * variants cover the design system; reused across profile, file browser, and
 * the later Task Board.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface VariantStyle {
  readonly bg: string;
  readonly fg: string;
  readonly border: string;
}

const VARIANT_STYLES: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: { bg: 'var(--color-blue-500)', fg: '#ffffff', border: 'var(--color-blue-500)' },
  secondary: { bg: '#ffffff', fg: 'var(--text-primary)', border: 'var(--border-subtle)' },
  ghost: { bg: 'transparent', fg: 'var(--text-secondary)', border: 'transparent' },
  danger: { bg: 'var(--color-red-500)', fg: '#ffffff', border: 'var(--color-red-500)' },
};

const SIZE_PADDING: Readonly<Record<ButtonSize, string>> = {
  sm: '0.25rem 0.625rem',
  md: '0.5rem 0.875rem',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Optional leading icon element. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  children,
  type = 'button',
  disabled,
  style,
  className = '',
  ...rest
}: ButtonProps): React.JSX.Element {
  const v = VARIANT_STYLES[variant];
  const composedStyle: CSSProperties = {
    backgroundColor: v.bg,
    color: v.fg,
    border: `1px solid ${v.border}`,
    padding: SIZE_PADDING[size],
    opacity: disabled === true ? 0.5 : 1,
    cursor: disabled === true ? 'not-allowed' : 'pointer',
    ...TYPE.bodyStrong,
    ...style,
  };
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg shadow-sm transition-shadow hover:shadow-md ${className}`}
      style={composedStyle}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
