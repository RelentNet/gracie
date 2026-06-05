/**
 * Generated DB types — PLACEHOLDER (Phase 1A).
 *
 * Phase 1B TODO: replace this hand-written placeholder with the output of
 * `supabase gen types typescript` run against the schema in
 * docs/04-database-schema.sql (see docs/07 §3). Until then we expose a minimal
 * `Database` shape so the typed client signatures compile without the SDK.
 *
 * The rich row interfaces live in `@gracie/shared` (camelCase domain types);
 * this `Database` type mirrors the raw Postgres (snake_case) surface that the
 * Supabase client is generic over.
 */

/** Minimal stand-in for the Supabase-generated `Database` type. */
export interface Database {
  readonly public: {
    readonly Tables: Record<string, never>;
    readonly Views: Record<string, never>;
    readonly Functions: Record<string, never>;
    readonly Enums: Record<string, never>;
  };
}

/** Table names present in the schema (docs/04). Useful for typed helpers. */
export const TABLE_NAMES = [
  'users',
  'settings',
  'clients',
  'client_aliases',
  'meeting_type_rules',
  'meetings',
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
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
