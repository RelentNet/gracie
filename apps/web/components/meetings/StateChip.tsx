import { Badge } from '@/components/ui/Badge';
import type { OccurrenceState } from '@/lib/meeting-occurrence';

/**
 * Plain-language chip for a meeting's occurrence state (never a raw pipeline enum).
 * Shared by the meeting-occurrence page and the client-detail Meetings tab so the
 * Upcoming / In session / Recorded labels + colors stay identical.
 */
const STATE_STYLES: Record<OccurrenceState, { label: string; bg: string; fg: string }> = {
  upcoming: { label: 'Upcoming', bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  in_session: { label: 'In session', bg: '#dcfce7', fg: '#166534' },
  ended: { label: 'Recorded', bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)' },
};

export function StateChip({ state }: { readonly state: OccurrenceState }): React.JSX.Element {
  const s = STATE_STYLES[state];
  return (
    <Badge bg={s.bg} fg={s.fg}>
      {s.label}
    </Badge>
  );
}
