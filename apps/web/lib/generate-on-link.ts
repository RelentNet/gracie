/**
 * Generate-on-link decision (pure). When a client is linked to a meeting that was
 * already RECORDED with no client (operator directive "record every meeting, link a
 * client afterward"), the notes pipeline should auto-run — but only when it makes
 * sense. No `server-only`, no DB, so it is unit-testable and importable from the data
 * layer. The I/O (load meeting, count docs, enqueue) lives in lib/data/calendar.ts.
 */
import type { PipelineStatus } from '@gracie/shared';

export interface GenerateOnLinkInput {
  /** The meeting's primary `client_id` AFTER the link/assign (null = still no client). */
  readonly clientId: string | null;
  /** `meetings.transcript_received` — true once the transcript was captured (recorded). */
  readonly transcriptReceived: boolean;
  /** Whether any meeting-generated documents already exist for this meeting. */
  readonly hasDocuments: boolean;
  /** Current `meetings.pipeline_status` — skip if generation is already running. */
  readonly pipelineStatus: PipelineStatus;
}

/**
 * True only when: the meeting now has a client to file under, its transcript was
 * already captured (so this is the recorded-but-was-unlinked case — a meeting linked
 * BEFORE it records generates via the normal `transcript.done` path), no docs exist
 * yet (idempotent — never double-generate), and generation isn't already in flight.
 */
export function shouldGenerateOnLink(input: GenerateOnLinkInput): boolean {
  if (input.clientId === null) return false;
  if (!input.transcriptReceived) return false;
  if (input.hasDocuments) return false;
  if (input.pipelineStatus === 'processing') return false;
  return true;
}
