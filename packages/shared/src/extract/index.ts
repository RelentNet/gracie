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
import ExcelJS, { type CellValue } from 'exceljs';
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

// ---------------------------------------------------------------------------
// Inline-preview converters (used by the WEB file-preview content route). These
// return render-ready shapes (sanitized HTML / value rows) instead of the flat
// text `extractText` produces, so the preview pane can show a formatted doc or a
// real table. Backend-only, like the rest of this module — the heavy parsers
// never reach the browser bundle.
// ---------------------------------------------------------------------------

/**
 * Strip anything script-like from HTML so the result is safe to render with
 * `dangerouslySetInnerHTML`: `<script>`/`<style>` blocks (incl. content), any
 * `on*=` event-handler attribute, and `javascript:` URLs on `href`/`src`.
 *
 * ponytail: regex strip, tuned for mammoth's known-clean output (it already emits
 * no scripts/handlers) as defense-in-depth. Swap for `sanitize-html`/DOMPurify if
 * this is ever pointed at genuinely untrusted HTML.
 */
export function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/\b(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** DOCX bytes → sanitized HTML for inline preview (formatting preserved). */
export async function docxToPreviewHtml(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer });
  return sanitizePreviewHtml(value);
}

/** Stringify one exceljs cell for a preview table (values only, no formatting). */
function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('hyperlink' in value) return value.text;
    if ('error' in value) return value.error;
    if ('result' in value && value.result !== undefined) return cellToString(value.result);
    if ('formula' in value || 'sharedFormula' in value) return '';
    return '';
  }
  return String(value);
}

/**
 * XLSX bytes → the first worksheet as value rows (same `string[][]` shape as CSV,
 * so the client reuses one table renderer). Rows are padded to equal width; the
 * lib's HTML output is never used.
 */
export async function xlsxToRows(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs bundles an older @types/node whose `Buffer` (Buffer<ArrayBuffer>) is
  // narrower than Node 24's Buffer<ArrayBufferLike>; the bytes are identical.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) return [];

  const rows: string[][] = [];
  let width = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell.value));
    });
    width = Math.max(width, cells.length);
    rows.push(cells);
  });
  for (const row of rows) while (row.length < width) row.push('');
  return rows;
}
