/**
 * /api/knowledge-base — Knowledge Base collection (M9, docs/05 + docs/08 §8 M9).
 *
 *   GET  — list KB documents (any role). Query: `search`, `tags` (comma list),
 *          `status` (active|archived|expired).
 *   POST — upload a KB document (editor: admin/standard; Viewer → 403, D14).
 *          Multipart form: `title` + `file` (required), `tags`, `description`,
 *          `expiration` (YYYY-MM-DD), `aiActive`. Stores the object server-side
 *          (the frontend never holds MinIO creds, docs/01 §2), inserts the row,
 *          and enqueues the KB embedding job. Returns 202 with the created doc.
 */
import { NextResponse, type NextRequest } from 'next/server';

import type { KbStatus } from '@gracie/shared';
import { putObject } from '@gracie/shared/storage';

import { getRequestUser } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import {
  buildKbKey,
  insertKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
} from '@/lib/data/knowledge-base';
import { enqueueKbIngest } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime (not edge).
export const runtime = 'nodejs';

const KB_STATUSES: readonly KbStatus[] = ['active', 'archived', 'expired'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Split a comma/newline-separated tag string into unique trimmed tags. */
function parseTagList(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim();
    const key = tag.toLowerCase();
    if (tag !== '' && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Any role may read the KB, but the request must be authenticated — when Logto
    // is configured this rejects anonymous callers (mirrors the chat/POST routes).
    await getRequestUser();

    const params = req.nextUrl.searchParams;
    const search = params.get('search')?.trim();
    const tagsParam = params.get('tags');
    const tags = tagsParam !== null ? parseTagList(tagsParam) : undefined;
    const statusParam = params.get('status');
    const status =
      statusParam !== null && (KB_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as KbStatus)
        : undefined;

    const documents = await listKnowledgeBaseDocuments({
      ...(search !== undefined && search !== '' ? { search } : {}),
      ...(tags !== undefined && tags.length > 0 ? { tags } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return NextResponse.json({ documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('kb_list_failed', message, 500);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return jsonError('forbidden', 'Adding knowledge-base documents requires editor role', 403);
    }

    const form = await req.formData().catch(() => null);
    if (form === null) return jsonError('bad_request', 'Expected multipart/form-data', 400);

    const title = (form.get('title') as string | null)?.trim() ?? '';
    if (title === '') return jsonError('bad_request', 'title is required', 400);

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return jsonError('bad_request', 'A non-empty file is required', 400);
    }

    const descriptionRaw = (form.get('description') as string | null)?.trim() ?? '';
    const description = descriptionRaw === '' ? null : descriptionRaw;
    const tags = parseTagList((form.get('tags') as string | null) ?? '');

    const expirationRaw = (form.get('expiration') as string | null)?.trim() ?? '';
    if (expirationRaw !== '' && !DATE_RE.test(expirationRaw)) {
      return jsonError('bad_request', 'expiration must be YYYY-MM-DD', 400);
    }
    const expirationDate = expirationRaw === '' ? null : expirationRaw;

    // AI-active by default; only an explicit 'false' opts the doc out of retrieval.
    const aiActive = (form.get('aiActive') as string | null) !== 'false';

    const bytes = Buffer.from(await file.arrayBuffer());
    const objectKey = buildKbKey(file.name, new Date());
    const mimeType = file.type === '' ? null : file.type;

    await putObject(objectKey, bytes, mimeType ?? undefined);
    const document = await insertKnowledgeBaseDocument({
      title,
      description,
      topicTags: tags,
      r2Key: objectKey,
      fileName: file.name,
      fileSize: bytes.byteLength,
      expirationDate,
      aiActive,
      uploadedByUserId: user.userId,
    });

    const jobId = await enqueueKbIngest({
      knowledgeBaseDocumentId: document.id,
      objectKey,
      fileName: file.name,
      mimeType,
    });

    return NextResponse.json({ document, jobId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('kb_create_failed', message, 500);
  }
}
