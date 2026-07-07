/**
 * Server-side retrieval for the Intelligence chat (Tab 7, docs/06 §7).
 *
 * Embeds the query through the pinned provider interface (never the OpenAI SDK;
 * D9/D11), pulls this client's chunks via `match_embeddings`, applies the
 * SECURITY-CRITICAL role gate, trims to top-K, and — only when requested — pulls
 * global Knowledge Base chunks via `match_kb_embeddings`. Server-only.
 *
 * The role gate has TWO complementary parts so it truly mirrors the restricted-
 * folder rule (D14) the file browser enforces, not just the transcript case:
 *  1. `filterChunksForRole` (pure) drops `source_type='transcript'` for non-admins
 *     — transcripts are embedded from meetings (not the `documents`/`folders`
 *     model), so source_type is the only signal available for them.
 *  2. `filterChunksByFolderVisibility` drops document-backed chunks (`upload` /
 *     `meeting_document`) whose owning folder is `restricted` and excludes the
 *     requester's role — the SAME authoritative signal as
 *     `lib/data/documents.ts isVisibleToRole`. This closes the gap where a
 *     non-transcript document filed in an admin-only folder would otherwise reach
 *     a non-admin via chat.
 *
 * Over-fetching: the client retrieval asks for a generous candidate pool so that,
 * after both filters remove hidden chunks for a non-admin, enough remain to fill
 * top-K. `match_embeddings` is NEVER called with a null client id — that would
 * leak every client's chunks (it has no client predicate when the id is null).
 */
import 'server-only';

import { getEmbedder, getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';
import { filterChunksForRole, type RetrievedChunk, type Role } from '@gracie/shared';

/** Client chunks kept in the prompt after the role gate. */
const CLIENT_TOP_K = 6;
/** Candidate pool fetched before filtering — headroom for the role gate's drops. */
const CLIENT_CANDIDATE_POOL = 24;
/** Knowledge Base chunks merged into the prompt when the toggle is on. */
const KB_TOP_K = 4;

/** Document-backed source types whose chunks can live in a restricted folder. */
const DOCUMENT_SOURCE_TYPES: ReadonlySet<RetrievedChunk['sourceType']> = new Set([
  'upload',
  'meeting_document',
]);

/** pgvector literal `[v1,v2,…]` for a 1536-dim embedding. */
function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

/** Embed a single query string through the pinned embedder (1536-dim). */
async function embedQuery(query: string): Promise<number[]> {
  const { provider, model } = await getEmbedder();
  const [vector] = await provider.embed({ input: [query], model });
  if (vector === undefined) throw new Error('chat: query embedding returned no vector');
  return vector;
}

/**
 * SECURITY-CRITICAL. Drop document-backed chunks whose owning folder is
 * `restricted` and does not allow the requester's role — mirroring the file
 * browser's `isVisibleToRole`. Admins keep everything; transcript/KB chunks are
 * not document-backed and pass through (transcripts are gated by source_type
 * upstream). Chunks for an unfiled document (`folder_id = null`) are unrestricted.
 */
export async function filterChunksByFolderVisibility(
  db: ServerClient,
  chunks: readonly RetrievedChunk[],
  role: Role,
): Promise<RetrievedChunk[]> {
  if (role === 'admin') return [...chunks];

  const documentIds = [
    ...new Set(
      chunks.filter((c) => DOCUMENT_SOURCE_TYPES.has(c.sourceType)).map((c) => c.sourceId),
    ),
  ];
  if (documentIds.length === 0) return [...chunks];

  const docResult = await db.from('documents').select('id, folder_id').in('id', documentIds);
  if (docResult.error !== null) {
    throw new Error(`chat: folder visibility (documents): ${docResult.error.message}`);
  }
  const folderIdByDocument = new Map<string, string | null>();
  const folderIds = new Set<string>();
  for (const doc of docResult.data ?? []) {
    folderIdByDocument.set(doc.id, doc.folder_id);
    if (doc.folder_id !== null) folderIds.add(doc.folder_id);
  }

  const hiddenFolderIds = new Set<string>();
  if (folderIds.size > 0) {
    const folderResult = await db
      .from('folders')
      .select('id, visibility, allowed_roles')
      .in('id', [...folderIds]);
    if (folderResult.error !== null) {
      throw new Error(`chat: folder visibility (folders): ${folderResult.error.message}`);
    }
    for (const folder of folderResult.data ?? []) {
      if (folder.visibility === 'restricted' && !folder.allowed_roles.includes(role)) {
        hiddenFolderIds.add(folder.id);
      }
    }
  }

  return chunks.filter((chunk) => {
    if (!DOCUMENT_SOURCE_TYPES.has(chunk.sourceType)) return true;
    const folderId = folderIdByDocument.get(chunk.sourceId) ?? null;
    return folderId === null || !hiddenFolderIds.has(folderId);
  });
}

export interface RetrieveContextInput {
  readonly clientId: string;
  readonly query: string;
  readonly role: Role;
  readonly includeKnowledgeBase: boolean;
}

export interface RetrievedContext {
  readonly clientChunks: readonly RetrievedChunk[];
  readonly knowledgeBaseChunks: readonly RetrievedChunk[];
}

/**
 * Retrieve role-filtered client context + optional KB context for one chat turn.
 */
export async function retrieveContext(input: RetrieveContextInput): Promise<RetrievedContext> {
  const db = getServerClient();
  const isAdmin = input.role === 'admin';
  const queryVector = toVectorLiteral(await embedQuery(input.query));

  // Client-scoped retrieval — over-fetch, then role-gate, then trim to top-K.
  const clientResult = await db.rpc('match_embeddings', {
    match_client_id: input.clientId,
    match_count: CLIENT_CANDIDATE_POOL,
    query_embedding: queryVector,
  });
  if (clientResult.error !== null) {
    throw new Error(`chat: match_embeddings: ${clientResult.error.message}`);
  }
  const candidates: RetrievedChunk[] = (clientResult.data ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    content: row.content,
    similarity: row.similarity,
  }));
  // SECURITY: drop transcript chunks (source_type) AND restricted-folder document
  // chunks (folder visibility) for non-admins BEFORE trimming to top-K.
  const roleFiltered = filterChunksForRole(candidates, isAdmin);
  const visibleChunks = await filterChunksByFolderVisibility(db, roleFiltered, input.role);
  const clientChunks = visibleChunks.slice(0, CLIENT_TOP_K);

  if (!input.includeKnowledgeBase) {
    return { clientChunks, knowledgeBaseChunks: [] };
  }

  // Knowledge Base retrieval — global (client_id=null), ai_active only.
  const kbResult = await db.rpc('match_kb_embeddings', {
    match_count: KB_TOP_K,
    query_embedding: queryVector,
  });
  if (kbResult.error !== null) {
    throw new Error(`chat: match_kb_embeddings: ${kbResult.error.message}`);
  }
  const knowledgeBaseChunks: RetrievedChunk[] = (kbResult.data ?? []).map((row) => ({
    id: row.id,
    sourceType: 'knowledge_base',
    sourceId: row.source_id,
    content: row.content,
    similarity: row.similarity,
  }));

  return { clientChunks, knowledgeBaseChunks };
}

export interface ChatClient {
  readonly name: string;
  readonly description: string;
}

/** Fetch the scoped client's name + description, or null if the client is absent. */
export async function getChatClient(clientId: string): Promise<ChatClient | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('clients')
    .select('name, description')
    .eq('id', clientId)
    .maybeSingle();
  if (error !== null) throw new Error(`chat: getChatClient: ${error.message}`);
  if (data === null) return null;
  return { name: data.name, description: data.description ?? '' };
}

/** Read `settings.ga_company_description`, falling back to a sane default. */
export async function getGaCompanyDescription(): Promise<string> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', 'ga_company_description')
    .maybeSingle();
  if (error !== null) throw new Error(`chat: getGaCompanyDescription: ${error.message}`);
  return typeof data?.value === 'string'
    ? data.value
    : 'Grace & Associates — a federal healthcare consulting firm.';
}
