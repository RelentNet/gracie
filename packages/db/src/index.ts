/**
 * @gracie/db — database access surface (Phase 1B: real Supabase clients).
 * Importing is side-effect free; env is read lazily on first client call.
 */
export { getServerClient } from './client.js';
export type { ServerClient } from './client.js';
export { getBrowserClient } from './client.browser.js';
export type { BrowserClient } from './client.browser.js';
export { getServerConfig, getBrowserConfig } from './config.js';
export type { SupabaseConfig } from './config.js';
export { TABLE_NAMES } from './types.js';
export type { Database, TableName } from './types.js';
export type { Json } from './database.types.js';
export {
  getCredential,
  listIntegrations,
  setIntegration,
  clearIntegrationSecret,
  recordTestResult,
  invalidateCredential,
  isManageableService,
  MANAGEABLE_SERVICES,
} from './credentials.js';
export type { IntegrationKey, IntegrationStatus, SetIntegrationParams } from './credentials.js';
export { encryptSecret, decryptSecret } from './crypto.js';
export { getActiveProvider, getEmbedder } from './ai.js';
