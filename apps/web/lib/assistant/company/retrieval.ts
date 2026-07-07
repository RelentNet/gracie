/**
 * Cross-client + Knowledge Base retrieval for the company-aware Assistant (P6B.1).
 * SERVER-ONLY. §A of the brief.
 *
 * The Intelligence chat's `retrieveContext` is client-scoped (it MUST pick one
 * client — a null id would leak every client's chunks). A company-wide assistant
 * instead retrieves across ALL clients via the new `match_all_embeddings` RPC and
 * gates AFTER fetch: over-fetch a candidate pool → run it through the central
 * {@link gateChunksForCaller} (transcripts + restricted folders) → trim to top-K.
 * Knowledge Base is retrieved separately by `match_kb_embeddings` (global,
 * `ai_active` only) exactly as Intelligence does. Nothing here bypasses a gate.
 */
import 'server-only';

import { getEmbedder, getServerClient } from '@gracie/db';
import type { RetrievedChunk } from '@gracie/shared';

import { gateChunksForCaller, type CompanyCaller } from './access.js';

/** Candidate pool fetched before gating — headroom for the role gate's drops. */
const CANDIDATE_POOL = 32;
/** Document/transcript chunks kept after gating + trim. */
const DOCUMENT_TOP_K = 8;
/** Knowledge Base chunks kept. */
const KB_TOP_K = 6;

/** A retrieved chunk that also carries its owning client id (cross-client search). */
export interface CompanyChunk extends RetrievedChunk {
  readonly clientId: string | null;
}

/** pgvector literal `[v1,v2,…]` for a 1536-dim embedding. */
function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

/** Embed a single query string through the pinned embedder (1536-dim). */
async function embedQuery(query: string): Promise<string> {
  const { provider, model } = await getEmbedder();
  const [vector] = await provider.embed({ input: [query], model });
  if (vector === undefined) throw new Error('company retrieval: query embedding returned no vector');
  return toVectorLiteral(vector);
}

/**
 * Cross-client document + transcript retrieval, ROLE-GATED for the caller. Returns
 * the top-K surviving chunks (each labelled with its `clientId`). A non-admin
 * NEVER receives a transcript chunk or a restricted-folder document chunk — the
 * gate runs on the full candidate pool before the trim.
 */
export async function retrieveCompanyDocuments(
  caller: CompanyCaller,
  query: string,
): Promise<CompanyChunk[]> {
  const db = getServerClient();
  const queryVector = await embedQuery(query);

  const result = await db.rpc('match_all_embeddings', {
    match_count: CANDIDATE_POOL,
    query_embedding: queryVector,
  });
  if (result.error !== null) {
    throw new Error(`company retrieval: match_all_embeddings: ${result.error.message}`);
  }
  const candidates: CompanyChunk[] = (result.data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    similarity: row.similarity,
    clientId: row.client_id,
  }));

  // SECURITY: gate BEFORE trimming to top-K, so hidden chunks can't displace
  // visible ones out of the returned window.
  const gated = await gateChunksForCaller(db, candidates, caller);
  return gated.slice(0, DOCUMENT_TOP_K);
}

/**
 * Global Knowledge Base retrieval (`ai_active` only, via `match_kb_embeddings`).
 * KB is firm-wide reference material with no per-role restriction, so no role gate
 * applies beyond the RPC's `ai_active` filter — but it is retrieved separately and
 * never mixed into the client-scoped pool.
 */
export async function retrieveKnowledgeBase(query: string): Promise<RetrievedChunk[]> {
  const db = getServerClient();
  const queryVector = await embedQuery(query);

  const result = await db.rpc('match_kb_embeddings', {
    match_count: KB_TOP_K,
    query_embedding: queryVector,
  });
  if (result.error !== null) {
    throw new Error(`company retrieval: match_kb_embeddings: ${result.error.message}`);
  }
  return (result.data ?? []).map((row) => ({
    id: row.id,
    sourceType: 'knowledge_base' as const,
    sourceId: row.source_id,
    content: row.content,
    similarity: row.similarity,
  }));
}
