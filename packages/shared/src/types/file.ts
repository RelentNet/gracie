import type {
  EmbeddingSource,
  PipelineRunSource,
  PipelineRunStatus,
} from '../constants/enums.js';
import type { ISOTimestamp, UUID } from './common.js';

/**
 * `pipeline_runs` table (docs/04) — execution log. `errorMessage` is Admin-only
 * (gated at the API layer).
 */
export interface PipelineRun {
  readonly id: UUID;
  readonly meetingId: UUID | null;
  readonly source: PipelineRunSource;
  readonly startedAt: ISOTimestamp;
  readonly completedAt: ISOTimestamp | null;
  readonly durationSeconds: number | null;
  readonly documentsGenerated: number;
  readonly status: PipelineRunStatus | null;
  /** ADMIN-ONLY (API gate). */
  readonly errorMessage: string | null;
  readonly createdAt: ISOTimestamp;
}

/**
 * `embeddings` table (docs/04). Vector is `vector(1536)` (pinned model, D9);
 * represented as a number[] at the type level. Backend-only in practice.
 */
export interface Embedding {
  readonly id: UUID;
  readonly sourceType: EmbeddingSource;
  readonly sourceId: UUID;
  readonly clientId: UUID | null;
  readonly chunkIndex: number;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly createdAt: ISOTimestamp;
}
