/**
 * The structured proposal an agentic action returns (P8 §5). PURE (no server-only
 * imports) so both the chat route and the client `ChatBubble` confirm card can
 * import it. A proposal is created by `create_automation` (which persists a
 * `pending_confirmation` automation) and surfaced to the client via the
 * `X-Assistant-Action` response header — the LLM never activates anything.
 */
import type { AutomationType } from '@gracie/shared';

export interface AutomationProposal {
  readonly kind: 'automation_proposal';
  /** The persisted `automations.id` (status `pending_confirmation`). */
  readonly automationId: string;
  readonly title: string;
  readonly type: AutomationType;
  /** Friendly type label (e.g. "Portfolio digest"). */
  readonly typeLabel: string;
  /** Human-readable schedule (e.g. "Every Monday at 9:00 AM ET"). */
  readonly scheduleLabel: string;
  /** Short "who receives this" summary. */
  readonly recipientsSummary: string;
  /** True when the automation emails an external recipient (needs admin approval). */
  readonly external: boolean;
}
