/**
 * Pure, framework-neutral automation label helpers (P8). No `server-only` and no
 * `'use client'` — safe to import from BOTH server code (the agentic action tools)
 * and client components (the /automations page, the confirm card).
 */
import type { AutomationType } from '@gracie/shared';

/** Friendly label for a catalog type. */
export const AUTOMATION_TYPE_LABELS: Record<AutomationType, string> = {
  client_report: 'Client report',
  portfolio_digest: 'Portfolio digest',
  activity_digest: 'Activity digest',
  reminder: 'Reminder',
  meeting_brief: 'Meeting brief',
  client_send: 'Client message',
};

/** A short "who receives this" summary from the recipients jsonb. */
export function recipientsSummary(recipients: unknown): string {
  const rec = (recipients ?? {}) as Record<string, unknown>;
  const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  const parts: string[] = [];
  const people = count(rec.userIds);
  const emails = count(rec.emails);
  const external = count(rec.externalEmails);
  if (people > 0) parts.push(`${people} ${people === 1 ? 'person' : 'people'}`);
  if (emails > 0) parts.push(`${emails} ${emails === 1 ? 'email' : 'emails'}`);
  if (external > 0) parts.push(`${external} external`);
  return parts.length > 0 ? parts.join(' · ') : 'you';
}
