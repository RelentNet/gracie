import type { ClientType } from '@gracie/shared';

import { Badge } from '@/components/ui/Badge';

/**
 * Small presentational helpers shared across the Contacts area (phase `CO`) — kept in
 * one place so the list, profile, org chart, and suggestions surfaces render orgs,
 * initials, and tenures consistently.
 */

/** Two-letter initials from a person's full name (for the avatar chip). */
export function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const initials = (first + second).toUpperCase();
  return initials !== '' ? initials : '?';
}

const ORG_TYPE_STYLE: Readonly<Record<ClientType, { bg: string; fg: string; label: string }>> = {
  client: { bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)', label: 'Client' },
  prospect: { bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)', label: 'Prospect' },
  lead: { bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)', label: 'Lead' },
  partner: { bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)', label: 'Partner' },
  internal: { bg: 'var(--color-slate-100)', fg: 'var(--color-navy-800)', label: 'Internal' },
};

/** A colored pill for an org's party type. */
export function OrgTypeBadge({ type }: { readonly type: ClientType }): React.JSX.Element {
  const s = ORG_TYPE_STYLE[type];
  return (
    <Badge bg={s.bg} fg={s.fg}>
      {s.label}
    </Badge>
  );
}

/** Format an ISO date (YYYY-MM-DD) as a short "Mon YYYY" (UTC, so date-only never shifts). */
export function formatMonthYear(iso: string | null): string {
  if (iso === null || iso === '') return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(
    date,
  );
}

/** A human tenure label: "Since Jan 2026" / "Jan 2024 – Mar 2026" / "Past". */
export function tenureLabel(
  startedOn: string | null,
  endedOn: string | null,
  isCurrent: boolean,
): string {
  const start = formatMonthYear(startedOn);
  const end = formatMonthYear(endedOn);
  if (isCurrent) return start !== '' ? `Since ${start}` : 'Current';
  if (start !== '' && end !== '') return `${start} – ${end}`;
  if (end !== '') return `Until ${end}`;
  if (start !== '') return `From ${start}`;
  return 'Past';
}
