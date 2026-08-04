/**
 * Brand logo — the configurable nav logo (Settings → Company → Branding).
 *
 *   GET    → stream the current logo bytes (ANY authenticated user; every role
 *            renders the nav). 404 when none is set → the nav falls back to text.
 *   POST   → admin uploads a new logo (multipart `file`; PNG/JPG/SVG, ≤ 1 MB).
 *   DELETE → admin removes the logo (reset to default).
 *
 * SVG SAFETY: an uploaded SVG is served with `image/svg+xml` and rendered ONLY
 * via `<img src>` in the nav — never inlined into the DOM — so the browser loads
 * it in secure static mode (no scripts, no external fetches). `nosniff` + a
 * `sandbox` CSP are belt-and-suspenders; upload is admin-only regardless.
 *
 * The object key lives in the `brand_logo_key` setting; bytes go to MinIO under
 * `branding/logo-<ts>.<ext>` via the same `putObject` path as `/api/upload`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject, getObjectStream, putObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getBrandLogoKey, setBrandLogoKey } from '@/lib/data/branding-settings';
import { getUserIdByLogtoId } from '@/lib/data/users';

// AWS SDK stream + @gracie/db (service-role) need the Node runtime (not edge).
export const runtime = 'nodejs';

const MAX_BYTES = 1024 * 1024; // 1 MB

/** Allowed upload MIME → stored extension + served content type. */
const ALLOWED: Readonly<Record<string, { ext: string; type: string }>> = {
  'image/png': { ext: 'png', type: 'image/png' },
  'image/jpeg': { ext: 'jpg', type: 'image/jpeg' },
  'image/svg+xml': { ext: 'svg', type: 'image/svg+xml' },
};

/** Stored extension → served content type (for GET). */
const TYPE_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Resolve an upload's stored ext + content type; prefers MIME, falls back to the name's extension. */
function resolveKind(file: File): { ext: string; type: string } | null {
  const byMime = ALLOWED[file.type];
  if (byMime !== undefined) return byMime;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const norm = ext === 'jpeg' ? 'jpg' : ext;
  return Object.values(ALLOWED).find((a) => a.ext === norm) ?? null;
}

export async function GET(): Promise<Response> {
  try {
    await getRequestUser(); // any authenticated user — every role renders the nav
    const key = await getBrandLogoKey();
    if (key === null) return jsonError('not_found', 'No brand logo set', 404);

    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const type = TYPE_BY_EXT[ext] ?? 'application/octet-stream';
    const { body, contentLength } = await getObjectStream(key);

    const headers = new Headers({
      'Content-Type': type,
      // Rendered only via <img>; nosniff + sandbox neutralise a hostile SVG.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // The <img src> carries a ?v=<key> cache-buster (key changes on every
      // upload), so a given key's bytes are immutable — cache for the session.
      'Cache-Control': 'private, max-age=3600',
    });
    if (contentLength !== undefined) headers.set('Content-Length', String(contentLength));
    return new Response(body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'unauthorized') return jsonError('unauthorized', 'Sign in required', 401);
    return jsonError('brand_logo_read_failed', message, 500);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return jsonError('bad_request', 'A logo file is required.', 400);
    }
    if (file.size > MAX_BYTES) {
      return jsonError('too_large', 'Logo must be 1 MB or smaller.', 413);
    }
    const kind = resolveKind(file);
    if (kind === null) {
      return jsonError('bad_request', 'Logo must be a PNG, JPG, or SVG image.', 400);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const newKey = `branding/logo-${Date.now()}.${kind.ext}`;
    await putObject(newKey, bytes, kind.type);

    const oldKey = await getBrandLogoKey();
    const byUserId = await getUserIdByLogtoId(user.userId).catch(() => null);
    await setBrandLogoKey(newKey, byUserId);
    // Best-effort cleanup of the replaced object — a leftover object is harmless.
    if (oldKey !== null && oldKey !== newKey) await deleteObject(oldKey).catch(() => {});

    return NextResponse.json({ brandLogoKey: newKey });
  } catch (error) {
    return jsonError('brand_logo_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function DELETE(): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    const key = await getBrandLogoKey();
    const byUserId = await getUserIdByLogtoId(user.userId).catch(() => null);
    await setBrandLogoKey('', byUserId);
    if (key !== null) await deleteObject(key).catch(() => {}); // best-effort
    return NextResponse.json({ brandLogoKey: null });
  } catch (error) {
    return jsonError('brand_logo_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
