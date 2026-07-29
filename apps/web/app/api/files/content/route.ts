/**
 * GET /api/files/content?key=<r2-key>
 *
 * Returns a text object's raw text for INLINE PREVIEW (markdown / plain text). A
 * browser `fetch()` of a MinIO presigned URL fails CORS, so text previews route
 * through this same-origin endpoint instead. Binary types (pdf, images) never
 * come here — they render straight from a presigned URL.
 *
 * Authorization reuses `canAccessKey` — the SAME check the presign route enforces
 * — so this opens no new access surface: restricted folders and recycle-bin items
 * are denied identically. Text-only + size-capped so it can never stream a large
 * binary back to the browser.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getObjectBytes } from '@gracie/shared/storage';

import { getRequestUser } from '@/lib/api-auth';
import { canAccessKey } from '@/lib/data/files';

/** Extensions this endpoint will return as text. Everything else is 415. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['md', 'markdown', 'txt', 'text']);
/** Inline-preview cap. Generated docs are a few KB; this only guards pathologies. */
const MAX_PREVIEW_BYTES = 1_000_000; // 1 MB

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
    if (!TEXT_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: { code: 'unsupported_type', message: 'Only text files can be previewed here' } },
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

    // ponytail: reads the whole object then size-checks — fine for text docs (KB-scale);
    // switch to a HEAD content-length pre-check only if large text files ever land here.
    const bytes = await getObjectBytes(key);
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return NextResponse.json(
        { error: { code: 'too_large', message: 'File is too large to preview — download it instead' } },
        { status: 413 },
      );
    }

    return NextResponse.json({ text: bytes.toString('utf-8') });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'content_failed', message } }, { status: 500 });
  }
}
