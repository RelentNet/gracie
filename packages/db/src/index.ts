/**
 * @gracie/db — database access surface.
 * Phase 1A exposes typed stubs only (no SDK, no env required to import).
 */
export { getServerClient } from './client.js';
export type { ServerClient } from './client.js';
export { getBrowserClient } from './client.browser.js';
export type { BrowserClient } from './client.browser.js';
export { TABLE_NAMES } from './types.js';
export type { Database, TableName } from './types.js';
