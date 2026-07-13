/**
 * Client-side view types for the /automations page. Mirror the API responses
 * (`AutomationView` / `AutomationRunView` / `AutomationRequestView`) but kept local
 * so the page never imports server-only data modules.
 */
import type { AutomationStatus, AutomationType } from '@gracie/shared';

export interface AutomationClientView {
  readonly id: string;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly title: string;
  readonly intent: string | null;
  readonly type: AutomationType;
  readonly params: unknown;
  readonly schedule: unknown;
  readonly scheduleLabel: string;
  readonly recipients: unknown;
  readonly hasExternalRecipient: boolean;
  readonly status: AutomationStatus;
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutomationRequestClientView {
  readonly id: string;
  readonly requestedByUserId: string | null;
  readonly requestedByName: string | null;
  readonly intent: string;
  readonly status: 'pending' | 'accepted' | 'dismissed';
  readonly notes: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

// Label helpers live in the framework-neutral module so the agentic action tools
// (server) and these client views share one source of truth.
export { AUTOMATION_TYPE_LABELS, recipientsSummary } from '@/lib/automations-shared';
