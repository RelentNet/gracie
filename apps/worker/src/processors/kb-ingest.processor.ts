/**
 * Knowledge Base ingest processor (P6, docs/06 §7).
 *
 * For one Knowledge Base document: fetch the object bytes from MinIO → extract
 * text by type (D8) → chunk → embed via the pinned provider interface
 * (`getEmbedder`, never the OpenAI SDK; D9/D11) → write `embeddings` rows
 * (`source_type='knowledge_base'`, `source_id=<kb id>`, `client_id=null`, 1536-dim).
 *
 * Mirrors `ingest.processor.ts` exactly, with two differences: KB embeddings are
 * global (no owning client), and there is no per-row status to update — a KB doc's
 * inclusion in retrieval is governed by `knowledge_base_documents.ai_active`
 * (checked in `match_kb_embeddings`), not by an embedding status. Re-runs are
 * idempotent: prior KB embeddings for this document are cleared before insert.
 *
 * Failure handling (docs/06 §8): unsupported type or no extractable text → log +
 * return (terminal; the doc simply contributes no embeddings until re-uploaded).
 * Transient errors (MinIO/provider) throw so BullMQ retries with backoff.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getEmbedder, getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import { EMBEDDING_DIMENSIONS, type AIProvider, type KbIngestJobPayload } from '@gracie/shared';
import { getObjectBytes } from '@gracie/shared/storage';

import { chunkText } from '../lib/chunk.js';
import { extractText } from '../lib/extract.js';

type EmbeddingInsert = Database['public']['Tables']['embeddings']['Insert'];

/** Outcome of a KB-ingest run (returned to BullMQ; visible in Bull Board). */
export interface KbIngestResult {
  readonly knowledgeBaseDocumentId: string;
  readonly chunks: number;
  readonly embeddings: number;
  readonly status: 'ok' | 'unsupported' | 'empty';
}

/** Max chunks embedded per provider request (well under the API's input cap). */
const EMBED_BATCH_SIZE = 96;

/** Embed chunks through the pinned provider interface, in bounded batches. */
async function embedInBatches(
  provider: AIProvider,
  model: string,
  chunks: readonly string[],
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embedded = await provider.embed({ input: batch, model });
    vectors.push(...embedded);
  }
  return vectors;
}

/** Build the KB-ingest processor, logging through the worker's Fastify logger. */
export function createKbIngestProcessor(
  logger: FastifyBaseLogger,
): Processor<KbIngestJobPayload, KbIngestResult> {
  return async (job: Job<KbIngestJobPayload>): Promise<KbIngestResult> => {
    const { knowledgeBaseDocumentId, objectKey, fileName, mimeType } = job.data;
    const db = getServerClient();
    const log = logger.child({ jobId: job.id, knowledgeBaseDocumentId, fileName });

    const bytes = await getObjectBytes(objectKey);
    const { text, unsupported } = await extractText(bytes, fileName, mimeType);

    if (unsupported) {
      log.warn('kb-ingest: unsupported file type — no embeddings produced');
      return { knowledgeBaseDocumentId, chunks: 0, embeddings: 0, status: 'unsupported' };
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      log.warn('kb-ingest: no extractable text — no embeddings produced');
      return { knowledgeBaseDocumentId, chunks: 0, embeddings: 0, status: 'empty' };
    }

    const { provider, model } = await getEmbedder();
    const vectors = await embedInBatches(provider, model, chunks);
    if (vectors.length !== chunks.length) {
      throw new Error(
        `kb-ingest: embedding count ${vectors.length} != chunk count ${chunks.length}`,
      );
    }

    // Idempotent re-runs: clear any prior KB embeddings for this document first.
    const cleared = await db
      .from('embeddings')
      .delete()
      .eq('source_type', 'knowledge_base')
      .eq('source_id', knowledgeBaseDocumentId);
    if (cleared.error !== null) {
      throw new Error(`kb-ingest: clear prior embeddings: ${cleared.error.message}`);
    }

    const rows: EmbeddingInsert[] = chunks.map((content, index) => {
      const vector = vectors[index] ?? [];
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `kb-ingest: embedding dim ${vector.length} != ${EMBEDDING_DIMENSIONS} (chunk ${index})`,
        );
      }
      return {
        source_type: 'knowledge_base',
        source_id: knowledgeBaseDocumentId,
        client_id: null,
        chunk_index: index,
        content,
        embedding: `[${vector.join(',')}]`,
      };
    });

    const inserted = await db.from('embeddings').insert(rows);
    if (inserted.error !== null) {
      throw new Error(`kb-ingest: insert embeddings: ${inserted.error.message}`);
    }

    log.info({ chunks: chunks.length, model }, 'kb-ingest complete');
    return {
      knowledgeBaseDocumentId,
      chunks: chunks.length,
      embeddings: rows.length,
      status: 'ok',
    };
  };
}
