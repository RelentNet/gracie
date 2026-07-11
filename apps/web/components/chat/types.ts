/**
 * Shared chat-thread types. Used by BOTH the client Intelligence tab and the
 * general `/assistant` page so the two stay visually and behaviourally identical
 * (docs/08 §M14 — "native to Gracie", one shared chat surface).
 */
import type { AutomationProposal } from '@/lib/assistant/actions/proposal';

export interface ChatMessage {
  /** Stable key within a thread (a client-side counter or a persisted row id). */
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /**
   * An optional PENDING action proposed this turn (P8). When set, the bubble renders
   * a Confirm/Cancel card — the deliberate step that activates it via a gated route.
   * The LLM never activates anything; it only proposes.
   */
  readonly action?: AutomationProposal;
}
