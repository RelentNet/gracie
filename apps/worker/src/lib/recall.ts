/**
 * Recall.ai bot dispatch + transcript fetch (docs/07 §1, §3).
 *
 * The implementation was promoted to `@gracie/shared/recall` (P4.2) so the web
 * on-demand join route can dispatch a bot SYNCHRONOUSLY without duplicating the
 * fetch logic. This module stays as the worker-side import path so the
 * bot-dispatch cron and the generation processor keep importing `../lib/recall.js`
 * unchanged — the P5b webhook → generation contract is untouched.
 */
export { dispatchRecallBot, fetchRecallTranscript } from '@gracie/shared/recall';
export type {
  RecallDispatchOptions,
  RecallFetchOptions,
  RecallTranscriptProvider,
} from '@gracie/shared/recall';
