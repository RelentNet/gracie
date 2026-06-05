/**
 * Supabase SERVER client — STUB (Phase 1A).
 *
 * Uses the service-role key (bypasses RLS) — backend/worker ONLY. Never ship
 * this client or its key to the browser (docs/03 §6, docs/07 §3).
 *
 * Phase 1A contract: importing this module is side-effect free and requires NO
 * env vars. The client is created LAZILY on first call to `getServerClient()`.
 * In Phase 1A there is no SDK wired, so the factory throws a clear error if
 * actually invoked — but merely importing it (e.g. for types) is safe.
 *
 * Phase 1B TODO:
 *   - add `@supabase/supabase-js` dependency
 *   - createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
 *   - read env via a validated config module (fail fast if missing at runtime)
 */
import type { Database } from './types.js';

/** Shape returned once the real client lands (Phase 1B). */
export type ServerClient = {
  readonly __database: Database;
};

/**
 * Lazily resolve the service-role Supabase client.
 *
 * Phase 1A: throws — there is no SDK or env wired yet. Call sites should not
 * invoke this during scaffold work; it exists to lock the signature.
 *
 * Phase 1B: memoize a single client instance (module-level cache) created from
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
export function getServerClient(): ServerClient {
  throw new Error(
    'Supabase server client is not implemented in Phase 1A. Wire @supabase/supabase-js + env in Phase 1B.',
  );
}
