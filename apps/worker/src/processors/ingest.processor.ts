/**
 * Ingest processor (P5a, docs/06 §4/§5/§8).
 *
 * For one uploaded document: fetch the object bytes from MinIO → extract text by
 * type (D8) → chunk → embed via the pinned provider interface (`getEmbedder`,
 * never the OpenAI SDK; D9/D11) → write `embeddings` rows (`source_type='upload'`,
 * 1536-dim) → update `documents.status`.
 *
 * Failure handling (docs/06 §8): unsupported type or no extractable text →
 * `needs_review` (terminal, no point retrying). Transient errors (MinIO/provider)
 * throw so BullMQ retries with backoff; after the attempt budget the job lands in
 * the failed set for inspection.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getEmbedder, getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import { EMBEDDING_DIMENSIONS, type AIProvider, type IngestJobPayload } from '@gracie/shared';
import { getObjectBytes } from '@gracie/shared/storage';

import { chunkText } from '../lib/chunk.js';
import { extractText } from '../lib/extract.js';

type DocumentStatus = Database['public']['Enums']['document_status'];
type EmbeddingInsert = Database['public']['Tables']['embeddings']['Insert'];

/** Outcome of an ingest run (returned to BullMQ; visible in Bull Board). */
export interface IngestResult {
  readonly documentId: string;
  readonly chunks: number;
  readonly embeddings: number;
  readonly status: 'ok' | 'unsupported' | 'empty';
}

/** Max chunks embedded per provider request (well under the API's input cap). */
const EMBED_BATCH_SIZE = 96;

/** Update a document's status, throwing on error. */
async function markDocument(
  db: ServerClient,
  documentId: string,
  status: DocumentStatus,
): Promise<void> {
  const { error } = await db.from('documents').update({ status }).eq('id', documentId);
  if (error !== null) {
    throw new Error(`ingest: mark document ${status}: ${error.message}`);
  }
}

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

/** Build the ingest processor, logging through the worker's Fastify logger. */
export function createIngestProcessor(
  logger: FastifyBaseLogger,
): Processor<IngestJobPayload, IngestResult> {
  return async (job: Job<IngestJobPayload>): Promise<IngestResult> => {
    const { documentId, clientId, objectKey, fileName, mimeType } = job.data;
    const db = getServerClient();
    const log = logger.child({ jobId: job.id, documentId, fileName });

    const bytes = await getObjectBytes(objectKey);
    const { text, unsupported } = await extractText(bytes, fileName, mimeType);

    if (unsupported) {
      log.warn('ingest: unsupported file type — flagging needs_review');
      await markDocument(db, documentId, 'needs_review');
      return { documentId, chunks: 0, embeddings: 0, status: 'unsupported' };
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      log.warn('ingest: no extractable text — flagging needs_review');
      await markDocument(db, documentId, 'needs_review');
      return { documentId, chunks: 0, embeddings: 0, status: 'empty' };
    }

    const { provider, model } = await getEmbedder();
    const vectors = await embedInBatches(provider, model, chunks);
    if (vectors.length !== chunks.length) {
      throw new Error(
        `ingest: embedding count ${vectors.length} != chunk count ${chunks.length}`,
      );
    }

    // Idempotent re-runs: clear any prior embeddings for this document first.
    const cleared = await db
      .from('embeddings')
      .delete()
      .eq('source_type', 'upload')
      .eq('source_id', documentId);
    if (cleared.error !== null) {
      throw new Error(`ingest: clear prior embeddings: ${cleared.error.message}`);
    }

    const rows: EmbeddingInsert[] = chunks.map((content, index) => {
      const vector = vectors[index] ?? [];
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `ingest: embedding dim ${vector.length} != ${EMBEDDING_DIMENSIONS} (chunk ${index})`,
        );
      }
      return {
        source_type: 'upload',
        source_id: documentId,
        client_id: clientId,
        chunk_index: index,
        content,
        embedding: `[${vector.join(',')}]`,
      };
    });

    const inserted = await db.from('embeddings').insert(rows);
    if (inserted.error !== null) {
      throw new Error(`ingest: insert embeddings: ${inserted.error.message}`);
    }

    await markDocument(db, documentId, 'ready');
    log.info({ chunks: chunks.length, model }, 'ingest complete');
    return { documentId, chunks: chunks.length, embeddings: rows.length, status: 'ok' };
  };
}
