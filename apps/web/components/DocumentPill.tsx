import { FileText, Mail, ListChecks, ScrollText, FileSearch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { DocumentPillType } from '@gracie/shared';

/**
 * DocumentPill (docs/08 §5). Colored pill + icon, one per generated document
 * category. Icon + text so meaning is not color-dependent (docs/08 §11).
 */

interface PillStyle {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
  readonly Icon: LucideIcon;
}

const PILL_STYLES: Readonly<Record<DocumentPillType, PillStyle>> = {
  analysis: {
    label: 'Analysis',
    bg: 'var(--color-blue-100)',
    fg: 'var(--color-blue-700)',
    Icon: FileSearch,
  },
  memo: {
    label: 'Memo',
    bg: 'var(--color-slate-100)',
    fg: 'var(--color-slate-600)',
    Icon: ScrollText,
  },
  summary: {
    label: 'Summary',
    bg: 'var(--color-emerald-100)',
    fg: 'var(--color-emerald-600)',
    Icon: FileText,
  },
  checklist: {
    label: 'Checklist',
    bg: 'var(--color-amber-100)',
    fg: 'var(--color-amber-600)',
    Icon: ListChecks,
  },
  email: {
    label: 'Email',
    bg: 'var(--color-blue-100)',
    fg: 'var(--color-blue-700)',
    Icon: Mail,
  },
};

export interface DocumentPillProps {
  readonly type: DocumentPillType;
}

export function DocumentPill({ type }: DocumentPillProps): React.JSX.Element {
  const style = PILL_STYLES[type];
  const { Icon } = style;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md"
      style={{
        backgroundColor: style.bg,
        color: style.fg,
        fontSize: '0.75rem',
        fontWeight: 600,
        padding: '0.125rem 0.5rem',
      }}
    >
      <Icon aria-hidden="true" size={14} />
      {style.label}
    </span>
  );
}
