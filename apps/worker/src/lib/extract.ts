/**
 * Text extraction for uploaded files (D8, docs/06 §5).
 *
 * The implementation was promoted to `@gracie/shared/extract` (P6B) so the web
 * Assistant attachment route can extract synchronously without duplicating the
 * parsers. This module stays as the worker-side import path so the ingest / KB
 * processors keep importing `../lib/extract.js` unchanged.
 */
export { extractText } from '@gracie/shared/extract';
export type { ExtractResult } from '@gracie/shared/extract';
