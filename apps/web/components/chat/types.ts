/**
 * Shared chat-thread types. Used by BOTH the client Intelligence tab and the
 * general `/assistant` page so the two stay visually and behaviourally identical
 * (docs/08 §M14 — "native to Gracie", one shared chat surface).
 */
export interface ChatMessage {
  /** Stable key within a thread (a client-side counter or a persisted row id). */
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
}
