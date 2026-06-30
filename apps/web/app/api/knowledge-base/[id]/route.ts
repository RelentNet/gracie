/**
 * /api/knowledge-base/[id] — single Knowledge Base document (M9, docs/05).
 *
 *   PATCH  — edit metadata / archive (editor: admin/standard). Body (JSON, all
 *            optional): `title`, `description`, `topicTags`, `expirationDate`,
 *            `aiActive`. Setting `aiActive=false` archives the doc — it stops
 *            being retrieved into chat (enforced by `match_kb_embeddings`).
 *   DELETE — remove the doc, its embeddings, and its stored object (admin only).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import {
  deleteKnowledgeBaseDocument,
  updateKnowledgeBaseDocument,
  type KbDocumentPatch,
} from '@/lib/data/knowledge-base';

// @gracie/db (supabase-js) + the S3 SDK are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Build a validated patch from an untrusted JSON body; null = a 400 message. */
function parsePatch(body: Record<string, unknown>): KbDocumentPatch | string {
  const patch: {
    title?: string;
    description?: string | null;
    topicTags?: string[];
    expirationDate?: string | null;
    aiActive?: boolean;
  } = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return 'title must be a non-empty string';
    }
    patch.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return 'description must be a string or null';
    }
    patch.description = body.description === null ? null : (body.description as string).trim();
  }
  if (body.topicTags !== undefined) {
    if (!Array.isArray(body.topicTags) || body.topicTags.some((t) => typeof t !== 'string')) {
      return 'topicTags must be an array of strings';
    }
    patch.topicTags = (body.topicTags as string[]).map((t) => t.trim()).filter((t) => t !== '');
  }
  if (body.expirationDate !== undefined) {
    if (body.expirationDate !== null) {
      if (typeof body.expirationDate !== 'string' || !DATE_RE.test(body.expirationDate)) {
        return 'expirationDate must be YYYY-MM-DD or null';
      }
    }
    patch.expirationDate = body.expirationDate as string | null;
  }
  if (body.aiActive !== undefined) {
    if (typeof body.aiActive !== 'boolean') return 'aiActive must be a boolean';
    patch.aiActive = body.aiActive;
  }
  return patch;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return jsonError('forbidden', 'Editing knowledge-base documents requires editor role', 403);
    }

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = parsePatch(body);
    if (typeof patch === 'string') return jsonError('bad_request', patch, 400);
    if (Object.keys(patch).length === 0) {
      return jsonError('bad_request', 'No updatable fields provided', 400);
    }

    const document = await updateKnowledgeBaseDocument(id, patch);
    if (document === null) return jsonError('not_found', 'Document not found', 404);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('kb_update_failed', message, 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return jsonError('forbidden', 'Deleting knowledge-base documents requires admin', 403);
    }

    const { id } = await params;
    const deleted = await deleteKnowledgeBaseDocument(id);
    if (deleted === null) return jsonError('not_found', 'Document not found', 404);

    // Best-effort object cleanup: the row + embeddings are already gone, so a
    // stale object must not turn the delete into a 500.
    try {
      await deleteObject(deleted.r2Key);
    } catch (cleanupError) {
      console.error('kb delete: object cleanup failed:', cleanupError);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('kb_delete_failed', message, 500);
  }
}
