/**
 * GET /api/files/raw?key=<r2-key>&download=1&name=<filename>
 *
 * Streams an object's raw bytes through the app (SAME ORIGIN). MinIO is internal-only
 * by design (docs/01 §2) — the browser can't reach a presigned MinIO URL — so the
 * download icon and the inline pdf/image/svg preview fetch their bytes here instead of
 * from `/api/files/url` (which signs against the internal S3 endpoint).
 *
 *   - default          → inline (browser renders pdf / image / svg in-page)
 *   - `download=1`      → `Content-Disposition: attachment` with `name` as the filename
 *
 * Authorization reuses `canAccessKey` — the SAME check the presign/content routes use —
 * so this opens no new access surface: restricted folders and recycle-bin keys stay
 * denied. Because the check RE-RUNS on every fetch (no durable URL handed out), a
 * deleted/binned document stops being fetchable immediately, closing the old
 * "presigned URL survives delete for 15 min" gap.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getObjectStream } from '@gracie/shared/storage';

import { getRequestUser } from '@/lib/api-auth';
import { canAccessKey } from '@/lib/data/files';
import { attachmentDisposition } from '@/lib/content-disposition';

// AWS SDK stream + Readable.toWeb need the Node runtime (not edge).
export const runtime = 'nodejs';

/** Extension → content type. Authoritative for inline preview; a MinIO object may
 *  carry a generic `application/octet-stream`, which would stop a pdf/svg rendering. */
const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (key === null || key === '') {
      return NextResponse.json(
        { error: { code: 'missing_key', message: 'key query param is required' } },
        { status: 400 },
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

    // Forward any Range header so <video> seeking works (HTTP 206) — a 200-only
    // response makes the browser treat the recording as non-seekable.
    const range = req.headers.get('range');
    const { body, contentType, contentLength, contentRange, statusCode } = await getObjectStream(
      key,
      range,
    );

    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const type =
      CONTENT_TYPE_BY_EXT[ext] ?? contentType ?? 'application/octet-stream';

    const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    if (contentLength !== undefined) headers.set('Content-Length', String(contentLength));
    if (contentRange !== undefined) headers.set('Content-Range', contentRange);
    if (searchParams.get('download') === '1') {
      const name = searchParams.get('name');
      let filename = name !== null && name !== '' ? name : (key.split('/').pop() ?? 'download');
      // A title-override fileName (e.g. "Receipt for Supplies") can lack the object's
      // extension; keep it so the OS still associates the download with an app.
      if (ext !== '' && !filename.toLowerCase().endsWith(`.${ext}`)) filename += `.${ext}`;
      headers.set('Content-Disposition', attachmentDisposition(filename));
    }
    return new Response(body, { status: statusCode, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'raw_failed', message } }, { status: 500 });
  }
}
