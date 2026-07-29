/**
 * GET /api/files/content?key=<r2-key>
 *
 * Returns a file's RENDER-READY content for inline preview as a small tagged
 * union — never raw binary:
 *   - md / txt        → { kind: 'text',  text }
 *   - csv / xlsx      → { kind: 'table', rows: string[][] }   (client renders a <table>)
 *   - docx            → { kind: 'html',  html }               (sanitized server-side)
 *
 * A browser `fetch()` of a MinIO presigned URL fails CORS, so previews that need
 * the bytes route through this same-origin endpoint. Binary types that DO render
 * from a URL (pdf, images incl. svg) never come here.
 *
 * Authorization reuses `canAccessKey` — the SAME check the presign route enforces
 * — so this opens no new access surface: restricted folders and recycle-bin items
 * are denied identically. docx/xlsx bytes are read via `getObjectBytes` and
 * converted server-side (mammoth / exceljs); only the converted text/rows/html is
 * ever sent to the browser.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { docxToPreviewHtml, xlsxToRows } from '@gracie/shared/extract';
import { getObjectBytes } from '@gracie/shared/storage';

import { getRequestUser } from '@/lib/api-auth';
import { canAccessKey } from '@/lib/data/files';
import { parseCsv } from '@/lib/csv';

export const runtime = 'nodejs';

type PreviewPayload =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'html'; html: string };

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'txt', 'text']);
/** Extensions this endpoint can convert. Everything else is 415. */
const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...TEXT_EXTENSIONS,
  'csv',
  'docx',
  'xlsx',
]);
/** Inline-preview cap — generous enough for real docx/xlsx (a few MB) but bounded. */
const MAX_PREVIEW_BYTES = 10_000_000; // 10 MB

async function toPayload(ext: string, bytes: Buffer): Promise<PreviewPayload> {
  if (ext === 'csv') return { kind: 'table', rows: parseCsv(bytes.toString('utf-8')) };
  if (ext === 'xlsx') return { kind: 'table', rows: await xlsxToRows(bytes) };
  if (ext === 'docx') return { kind: 'html', html: await docxToPreviewHtml(bytes) };
  return { kind: 'text', text: bytes.toString('utf-8') };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');

    if (key === null || key === '') {
      return NextResponse.json(
        { error: { code: 'missing_key', message: 'key query param is required' } },
        { status: 400 },
      );
    }

    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: { code: 'unsupported_type', message: 'This file type cannot be previewed here' } },
        { status: 415 },
      );
    }

    const user = await getRequestUser();
    const allowed = await canAccessKey(key, user.role);
    if (!allowed) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for this path' } },
        { status: 403 },
      );
    }

    // ponytail: reads the whole object then size-checks — fine at KB–few-MB doc scale;
    // switch to a HEAD content-length pre-check only if very large files ever land here.
    const bytes = await getObjectBytes(key);
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return NextResponse.json(
        { error: { code: 'too_large', message: 'File is too large to preview — download it instead' } },
        { status: 413 },
      );
    }

    return NextResponse.json(await toPayload(ext, bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'content_failed', message } }, { status: 500 });
  }
}
