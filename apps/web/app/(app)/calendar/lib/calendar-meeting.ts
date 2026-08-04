/**
 * Small pure helpers for meeting/org presentation on the calendar (docs/08 §M7).
 * Extracted verbatim from the calendar page — status mapping, attention flag,
 * party-type labels, and the month-grid pill caption.
 */
import type { BadgeStatus, CalendarMeeting, ClientType, PipelineStatus } from '@gracie/shared';

/** Map a DB `pipeline_status` to the UI `BadgeStatus` vocabulary (docs/08 §5). */
export function toBadgeStatus(status: PipelineStatus): BadgeStatus {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'in_progress':
    case 'awaiting_transcript':
    case 'processing':
      return 'processing';
    case 'complete':
      return 'complete';
    case 'needs_attention':
      return 'needs-review';
    case 'cancelled':
      return 'overdue';
  }
}

/** A meeting needs attention when it's external with no linked org yet (amber). */
export function meetingNeedsAttention(m: CalendarMeeting): boolean {
  return !m.isInternal && m.orgs.length === 0;
}

/** Non-internal party types offered when creating an org from a domain. */
export const CREATE_ORG_TYPES: ReadonlyArray<{
  readonly value: ClientType;
  readonly label: string;
}> = [
  { value: 'client', label: 'Client' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'lead', label: 'Lead' },
  { value: 'partner', label: 'Partner' },
];

/** Human label for a party type (chip caption). */
export function orgTypeLabel(type: ClientType): string {
  return CREATE_ORG_TYPES.find((t) => t.value === type)?.label ?? 'Internal';
}

/** A short caption of a meeting's org state for the month-grid pill. */
export function meetingGridLabel(m: CalendarMeeting): string {
  if (m.isInternal) return 'Internal';
  if (m.orgs.length === 1) return m.orgs[0]?.name ?? 'Meeting';
  if (m.orgs.length > 1) return `${m.orgs.length} clients`;
  if (m.unknownOrgDomains.length > 0) return `${m.unknownOrgDomains[0]} · no client`;
  return m.title ?? 'Meeting';
}
