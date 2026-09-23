/**
 * DEMO EMBED — give the Intelligence chat something to retrieve in the sandbox.
 *
 * Run AFTER `demo-cbg.ts` (which wipes the embeddings table), with the sandbox env
 * loaded:
 *   ./apps/web/node_modules/.bin/tsx packages/db/seed/demo-embed.ts
 *
 * What it writes, and how that compares to production:
 *   - `transcript.md` → source_type 'transcript', source_id = the MEETING id. This is
 *     exactly what the generate pipeline writes (embedTranscript).
 *   - the six generated documents → source_type 'meeting_document', source_id = the
 *     DOCUMENT id. Retrieval already supports this type (with folder-visibility
 *     filtering), but NOTHING in production writes it today — so in the real app a
 *     non-admin's chat, which never sees transcripts, knows nothing about meetings.
 *     Doing it here previews what closing that gap looks like.
 *
 * Embeddings go through `getEmbedder()`, so this uses whichever route the app would
 * (OpenAI key first, else OpenRouter) and the same pinned 1536-dim model.
 *
 * SAFETY: replaces every row in `embeddings`, so it runs only where `assertDemoTarget`
 * (demo-guard.ts) allows: local, or a demo host named in `DEMO_SEED_TARGET`.
 */
import { EMBEDDING_DIMENSIONS } from '../../shared/src/index.js';
import { getObjectBytes } from '../../shared/src/storage/index.js';
import { chunkText } from '../../../apps/worker/src/lib/chunk.js';
import { getEmbedder, getServerClient } from '../src/index.js';

import { assertDemoTarget } from './demo-guard.js';

assertDemoTarget();

/** Chunks per provider request — same bound as the pipeline's EMBED_BATCH_SIZE. */
const BATCH = 96;

interface Pending {
  readonly sourceType: 'transcript' | 'meeting_document';
  readonly sourceId: string;
  readonly clientId: string | null;
  readonly chunkIndex: number;
  readonly content: string;
}

async function main(): Promise<void> {
  const db = getServerClient();
  const { provider, model } = await getEmbedder();
  console.log(`embedding with ${provider.id} / ${model}`);

  const { data: docs, error } = await db
    .from('documents')
    .select('id, meeting_id, client_id, r2_key, file_name')
    .is('deleted_at', null)
    .not('meeting_id', 'is', null);
  if (error !== null) throw new Error(`load documents: ${error.message}`);

  const pending: Pending[] = [];
  for (const doc of docs ?? []) {
    const text = (await getObjectBytes(doc.r2_key)).toString('utf8');
    const isTranscript = doc.file_name === 'transcript.md';
    chunkText(text).forEach((content, chunkIndex) => {
      pending.push({
        sourceType: isTranscript ? 'transcript' : 'meeting_document',
        sourceId: isTranscript ? doc.meeting_id! : doc.id,
        clientId: doc.client_id,
        chunkIndex,
        content,
      });
    });
  }
  console.log(`${docs?.length ?? 0} documents → ${pending.length} chunks`);

  const cleared = await db.from('embeddings').delete().not('id', 'is', null);
  if (cleared.error !== null) throw new Error(`clear embeddings: ${cleared.error.message}`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const vectors = await provider.embed({ model, input: batch.map((p) => p.content) });
    if (vectors.length !== batch.length) {
      throw new Error(`embedding count ${vectors.length} != batch size ${batch.length}`);
    }
    const rows = batch.map((p, j) => {
      const v = vectors[j]!;
      if (v.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`embedding dim ${v.length} != ${EMBEDDING_DIMENSIONS}`);
      }
      return {
        source_type: p.sourceType,
        source_id: p.sourceId,
        client_id: p.clientId,
        chunk_index: p.chunkIndex,
        content: p.content,
        embedding: `[${v.join(',')}]`,
      };
    });
    const inserted = await db.from('embeddings').insert(rows);
    if (inserted.error !== null) throw new Error(`insert embeddings: ${inserted.error.message}`);
    console.log(`  ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
  }
  console.log('DEMO EMBED COMPLETE');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
