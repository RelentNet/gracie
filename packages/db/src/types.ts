/**
 * Generated DB types (Phase 1B).
 *
 * `Database` is generated from the LIVE schema via Supabase postgres-meta
 * (`/generators/typescript`) against docs/04-database-schema.sql. Regenerate
 * after migrations. The rich camelCase domain types live in `@gracie/shared`;
 * `Database` mirrors the raw snake_case Postgres surface the client is generic
 * over.
 */
export type { Database } from './database.types.js';

/** Table names present in the schema (docs/04). Useful for typed helpers. */
export const TABLE_NAMES = [
  'users',
  'settings',
  'clients',
  'client_aliases',
  'client_domains',
  'meeting_type_rules',
  'meetings',
  'meeting_clients',
  'folders',
  'documents',
  'tasks',
  'task_notes',
  'client_notes',
  'client_tabs',
  'master_record_entries',
  'daily_syncs',
  'pre_meeting_briefs',
  'pipeline_runs',
  'knowledge_base_documents',
  'embeddings',
  'notifications',
  'ai_providers',
  'integration_credentials',
  'assistant_chats',
  'assistant_messages',
  'assistant_attachments',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
