/**
 * Text extraction for uploaded files (D8, docs/06 §5).
 *
 * Shared helper: the WORKER ingest/KB processors extract asynchronously here, and
 * the WEB Assistant attachment route (`/api/assistant/attachments`) extracts
 * synchronously so file Q&A can inject text into the prompt with no embeddings.
 * Kept in `@gracie/shared/extract` (a backend-only subpath, like `/storage`) so
 * the heavy parser deps never reach the browser bundle.
 *
 * In scope: `.docx` → mammoth, `.pdf` → unpdf, `.csv` → papaparse,
 * `.txt`/`.md` → native UTF-8. Audio (`.mp3`/`.mp4`) is intentionally OUT of scope
 * (Phase 2 / Whisper) — recognized and flagged, never silently embedded.
 *
 * NOTE on the PDF library: D8 names `pdf-parse`, but pdf-parse bundles an old
 * webpack pdf.js UMD build that esbuild/tsx corrupts at load (non-deterministic
 * "bad XRef entry" / "Command token too long") — and the worker runs under tsx in
 * both `dev` and `start`. `unpdf` (a maintained, bundler/serverless-safe pdf.js
 * wrapper) extracts the same text reliably under tsx, so it is used here in
 * pdf-parse's place. Swap back if D8 is ever revisited with a tsx-safe pdf-parse.
 */
import mammoth from 'mammoth';
import Papa from 'papaparse';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

/** Outcome of an extraction attempt. */
export interface ExtractResult {
  /** Extracted plain text (empty when `unsupported`). */
  readonly text: string;
  /** True when the type is recognized but intentionally unsupported (audio) or unknown. */
  readonly unsupported: boolean;
}

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'text', 'log']);
const AUDIO_VIDEO_EXTENSIONS = new Set(['mp3', 'mp4', 'm4a', 'wav', 'mov', 'avi']);

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Lower-cased file extension without the dot (''  if none). */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Extract text from a file's bytes, dispatched by extension first, MIME second.
 * Unknown/binary types are flagged `unsupported` rather than embedded as garbage.
 */
export async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string | null,
): Promise<ExtractResult> {
  const ext = extensionOf(fileName);
  const mime = mimeType ?? '';

  if (AUDIO_VIDEO_EXTENSIONS.has(ext) || mime.startsWith('audio/') || mime.startsWith('video/')) {
    return { text: '', unsupported: true };
  }

  if (ext === 'docx' || mime === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, unsupported: false };
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join('\n') : text, unsupported: false };
  }

  if (ext === 'csv' || mime === 'text/csv') {
    const parsed = Papa.parse<string[]>(buffer.toString('utf8'), { skipEmptyLines: true });
    const rows = parsed.data.map((row) => (Array.isArray(row) ? row.join(' | ') : String(row)));
    return { text: rows.join('\n'), unsupported: false };
  }

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
    return { text: buffer.toString('utf8'), unsupported: false };
  }

  return { text: '', unsupported: true };
}
