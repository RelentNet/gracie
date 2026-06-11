/**
 * Text chunking for embedding (docs/06 §5). Splits on character windows with a
 * small overlap, preferring whitespace boundaries so words/sentences aren't cut
 * mid-token. Sized well under the pinned embedder's per-input token limit.
 */

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  readonly maxChars?: number;
  /** Characters of overlap carried into the next chunk (continuity for retrieval). */
  readonly overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 1_500;
const DEFAULT_OVERLAP_CHARS = 200;

/** Split `text` into overlapping chunks. Returns `[]` for empty/whitespace input. */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (normalized === '') return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);

    // Prefer a whitespace boundary in the latter half of the window.
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf(' ', end),
        normalized.lastIndexOf('\n', end),
      );
      if (boundary > start + maxChars / 2) end = boundary;
    }

    const piece = normalized.slice(start, end).trim();
    if (piece !== '') chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
