/**
 * Per-client logo — shown instead of the initials avatar chip. Mirrors the
 * firm-wide brand logo (`/api/brand/logo`, #86), scoped to one client.
 *
 *   GET    → stream the client's logo bytes (ANY authenticated user — all staff
 *            see all clients). 404 when none is set → the avatar falls back to
 *            initials.
 *   POST   → editor uploads a logo (multipart `file`; PNG/JPG/SVG, ≤ 1 MB).
 *   DELETE → editor removes the logo (back to initials).
 *
 * SVG SAFETY: an uploaded SVG is served with `image/svg+xml` and rendered ONLY
 * via `<img src>` (ClientAvatar) — never inlined — so the browser loads it in
 * secure static mode (no scripts, no external fetches). `nosniff` + a `sandbox`
 * CSP are belt-and-suspenders; upload is editor-only regardless.
 *
 * Bytes go to MinIO under `clients/<clientId>/logo-<ts>.<ext>` via the same
 * `putObject` path as the brand logo; the key lives in `clients.logo_key`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject, getObjectStream, putObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin, isEditor } from '@/lib/api-auth';
import { getClient, redactClientForRole, setClientLogoKey } from '@/lib/data/clients';

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  try {
    await getRequestUser(); // any authenticated user — all staff see all clients
    const { clientId } = await params;
    const client = await getClient(clientId);
    if (client === null || client.logoKey === null) {
      return jsonError('not_found', 'No client logo set', 404);
    }
    const key = client.logoKey;

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
    return jsonError('client_logo_read_failed', message, 500);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isEditor(user)) return jsonError('forbidden', 'Editor access required', 403);

  try {
    const { clientId } = await params;
    const existing = await getClient(clientId);
    if (existing === null) return jsonError('not_found', 'Unknown client', 404);

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
    const newKey = `clients/${clientId}/logo-${Date.now()}.${kind.ext}`;
    await putObject(newKey, bytes, kind.type);

    const client = await setClientLogoKey(clientId, newKey);
    // Best-effort cleanup of the replaced object — a leftover object is harmless.
    if (existing.logoKey !== null && existing.logoKey !== newKey) {
      await deleteObject(existing.logoKey).catch(() => {});
    }

    return NextResponse.json({ client: redactClientForRole(client, isAdmin(user)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' ? 404 : 500;
    return jsonError('client_logo_write_failed', message, status);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isEditor(user)) return jsonError('forbidden', 'Editor access required', 403);

  try {
    const { clientId } = await params;
    const existing = await getClient(clientId);
    if (existing === null) return jsonError('not_found', 'Unknown client', 404);

    const client = await setClientLogoKey(clientId, null);
    if (existing.logoKey !== null) await deleteObject(existing.logoKey).catch(() => {}); // best-effort
    return NextResponse.json({ client: redactClientForRole(client, isAdmin(user)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' ? 404 : 500;
    return jsonError('client_logo_write_failed', message, status);
  }
}
