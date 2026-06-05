/**
 * Supabase BROWSER client — STUB (Phase 1A).
 *
 * Uses the anon key and is RLS-bound (frontend-safe). Reads only — RLS policies
 * in docs/04 enforce row visibility (defense-in-depth; API middleware is
 * primary). NEVER use the service-role key here (docs/03 §6).
 *
 * Phase 1A contract: import is side-effect free and requires NO env vars; the
 * client is created lazily on first call.
 *
 * Phase 1B TODO:
 *   - add `@supabase/supabase-js`
 *   - createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *   - attach the Logto JWT so auth_role()/auth_uid() resolve in RLS
 */
import type { Database } from './types.js';

/** Shape returned once the real anon client lands (Phase 1B). */
export type BrowserClient = {
  readonly __database: Database;
};

/**
 * Lazily resolve the anon (RLS-bound) Supabase client.
 *
 * Phase 1A: throws — no SDK/env wired yet. Locks the signature only.
 *
 * Phase 1B: memoize a single anon client (module-level cache) created from
 * NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY, with the Logto JWT
 * attached so RLS resolves auth_role()/auth_uid().
 */
export function getBrowserClient(): BrowserClient {
  throw new Error(
    'Supabase browser client is not implemented in Phase 1A. Wire @supabase/supabase-js + env in Phase 1B.',
  );
}
