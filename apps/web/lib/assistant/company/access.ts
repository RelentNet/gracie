/**
 * Central access-control module for the company-aware Assistant (P6B.1) —
 * SERVER-ONLY runtime half.
 *
 * SECURITY-CRITICAL. Every retrieval result and every structured-tool result the
 * Assistant produces flows through THIS module (plus its pure sibling
 * ./access-policy.ts). It is the single source of truth for "what may the asking
 * user see", and it deliberately does NOT invent new rules — it REUSES the exact
 * authorities the shipped app already enforces:
 *   - {@link filterChunksForRole} (@gracie/shared) — drops `transcript` chunks for
 *     non-admins (same gate the Intelligence chat uses).
 *   - {@link filterChunksByFolderVisibility} (lib/data/chat-retrieval) — drops
 *     restricted-folder document chunks the caller's role may not see.
 *   - {@link redactClientForCaller} / {@link isFolderVisibleToRole}
 *     (./access-policy) — the pure client-financials + folder-visibility mirrors.
 *
 * HARD OFF-LIMITS (no path, no role): the `settings` table, `integration_credentials`
 * (API keys), and any other user's Assistant data. Nothing here reads them, and the
 * tools that import this module only ever SELECT from clients/tasks/meetings/
 * knowledge-base/embeddings. READ-ONLY throughout.
 */
import 'server-only';

import { filterChunksForRole, type RetrievedChunk } from '@gracie/shared';
import type { ServerClient } from '@gracie/db';

import { filterChunksByFolderVisibility } from '../../data/chat-retrieval.js';
import type { CompanyCaller } from './access-policy.js';

export { toCompanyCaller, redactClientForCaller, isFolderVisibleToRole } from './access-policy.js';
export type { CompanyCaller, FolderVisibility } from './access-policy.js';

/**
 * SECURITY-CRITICAL single gate for retrieved chunks. Applies BOTH shipped gates
 * in order: `filterChunksForRole` (transcript source-type) then
 * `filterChunksByFolderVisibility` (restricted folders). Admins keep everything.
 *
 * Generic over the chunk shape: both underlying gates only ever DROP elements
 * (never remap them), so any extra fields on the candidates (e.g. `clientId` from
 * `match_all_embeddings`) survive on the returned objects. Callers MUST run their
 * candidate pool through here BEFORE trimming to top-K and BEFORE any chunk reaches
 * the model or the user.
 */
export async function gateChunksForCaller<T extends RetrievedChunk>(
  db: ServerClient,
  chunks: readonly T[],
  caller: CompanyCaller,
): Promise<T[]> {
  // Both filters are identity-preserving subset selections, so the narrowing to
  // `RetrievedChunk` is only at the type level — the runtime objects are still `T`.
  const roleFiltered = filterChunksForRole(chunks, caller.isAdmin) as T[];
  const visible = await filterChunksByFolderVisibility(db, roleFiltered, caller.role);
  return visible as T[];
}
