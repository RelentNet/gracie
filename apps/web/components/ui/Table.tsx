import type { CSSProperties, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Table primitives — compact, data-dense (docs/08 §1, §4). Generic and
 * unstyled-by-content so they can back the client-scoped task table, transcript
 * history, and the later cross-client Task Board. Use semantic table elements
 * (docs/08 §11).
 */
export interface TableProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function Table({ children, className = '' }: TableProps): React.JSX.Element {
  return (
    <div
      className="overflow-x-auto rounded-lg border bg-white"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <table className={`w-full border-collapse text-left ${className}`}>{children}</table>
    </div>
  );
}

export function THead({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <tbody>{children}</tbody>;
}

export interface TRowProps {
  readonly children: ReactNode;
  /** Highlight tone for the whole row (e.g. overdue = red, 48h = amber). */
  readonly tone?: 'default' | 'critical' | 'warning';
}

const ROW_TONE_BG: Readonly<Record<NonNullable<TRowProps['tone']>, string | undefined>> = {
  default: undefined,
  critical: 'var(--color-red-100)',
  warning: 'var(--color-amber-100)',
};

export function TRow({ children, tone = 'default' }: TRowProps): React.JSX.Element {
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: ROW_TONE_BG[tone],
      }}
    >
      {children}
    </tr>
  );
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  readonly children: ReactNode;
}

export function TH({ children, style, ...rest }: THProps): React.JSX.Element {
  return (
    <th
      scope="col"
      className="px-4 py-2"
      style={{ ...TYPE.label, color: 'var(--text-secondary)', ...style }}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  readonly children: ReactNode;
}

export function TCell({ children, style, ...rest }: TCellProps): React.JSX.Element {
  const cellStyle: CSSProperties = { ...TYPE.body, ...style };
  return (
    <td className="px-4 py-3 align-middle" style={cellStyle} {...rest}>
      {children}
    </td>
  );
}
