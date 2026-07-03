/**
 * POST /api/assistant/attachments — upload a file for chat-scoped Q&A.
 *
 * Any role. Multipart form-data: `file` (required) + `chatId` (optional). Extracts
 * text SYNCHRONOUSLY with the promoted shared extractor (`@gracie/shared/extract`)
 * and stores it on `assistant_attachments` — NO embeddings, NEVER mixed with
 * client documents / KB (spec §3, §11). Attachments are ephemeral and scoped to
 * one conversation: if `chatId` is omitted a new chat is created and returned, so
 * every attachment belongs to exactly one owned chat.
 *
 * The raw file is retained in MinIO best-effort (`r2_key`); a storage failure does
 * NOT fail the upload because the extracted text is what powers Q&A.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getActiveProvider } from '@gracie/db';
import { extractText } from '@gracie/shared/extract';
import { putObject } from '@gracie/shared/storage';

import { getAssistantUser } from '@/lib/assistant/user';
import { createChat, getChat, insertAttachment } from '@/lib/data/assistant';

export const runtime = 'nodejs';

/** Max upload size — generous for documents, small enough to extract inline. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_HINT = 'Supported types: PDF, DOCX, TXT, MD, CSV.';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Object key under `assistant/<chatId>/<ms>-<file>` (isolated from client docs). */
function buildAttachmentKey(chatId: string, fileName: string, now: Date): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  return `assistant/${chatId}/${now.getTime()}-${safe}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const form = await req.formData().catch(() => null);
    if (form === null) return jsonError('bad_request', 'Expected multipart/form-data', 400);

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return jsonError('bad_request', 'A non-empty file is required', 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return jsonError('file_too_large', `File exceeds the 15 MB limit. ${SUPPORTED_HINT}`, 413);
    }

    // Resolve (or create) the owning conversation.
    const chatIdRaw = form.get('chatId');
    let chatId: string;
    if (typeof chatIdRaw === 'string' && chatIdRaw !== '') {
      const chat = await getChat(ownerId, chatIdRaw);
      if (chat === null) return jsonError('not_found', 'Conversation not found', 404);
      chatId = chat.id;
    } else {
      const { model } = await getActiveProvider();
      chatId = (await createChat(ownerId, model)).id;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type === '' ? null : file.type;

    const { text, unsupported } = await extractText(bytes, file.name, mimeType);
    if (unsupported) {
      return jsonError('unsupported_type', `That file type can’t be read. ${SUPPORTED_HINT}`, 415);
    }
    if (text.trim() === '') {
      return jsonError('empty_extraction', 'No text could be extracted from that file.', 422);
    }

    // Best-effort raw retention — never blocks the upload on a storage hiccup.
    let r2Key: string | null = null;
    try {
      const key = buildAttachmentKey(chatId, file.name, new Date());
      await putObject(key, bytes, mimeType ?? undefined);
      r2Key = key;
    } catch (storageError) {
      console.error('assistant attachment storage error:', storageError);
    }

    const attachment = await insertAttachment({
      ownerId,
      chatId,
      fileName: file.name,
      extractedText: text,
      r2Key,
    });

    return NextResponse.json({ attachment, chatId }, { status: 201 });
  } catch (error) {
    return jsonError('attachment_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
