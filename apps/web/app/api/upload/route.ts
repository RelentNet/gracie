/**
 * POST /api/upload — manual file upload → ingest (P5a, docs/05 Module 3, docs/06 §5).
 *
 * Editor-only (admin/standard); Viewer → 403 (D14). Server-side receipt: the
 * frontend posts the file bytes here (never holding MinIO creds, docs/01 §2). For
 * each file we store the object in MinIO under
 * `clients/[slug]/uploads/[YYYY-MM-DD]/<file>`, insert a `documents` row
 * (`source_badge='upload'`), and enqueue an ingest job. Returns 202 with the
 * created document + job ids; extraction/embedding happen async in apps/worker.
 *
 * Multipart form: `clientId` (text) + one or more `file` parts.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { putObject } from '@gracie/shared/storage';

import { getRequestUser } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import { getClient } from '@/lib/data/clients';
import { buildUploadKey, clientSlug, insertUploadDocument } from '@/lib/data/uploads';
import { enqueueIngest } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime (not edge).
export const runtime = 'nodejs';

interface UploadedFileResult {
  readonly documentId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly jobId: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Upload requires editor role' } },
        { status: 403 },
      );
    }

    const form = await req.formData().catch(() => null);
    if (form === null) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Expected multipart/form-data' } },
        { status: 400 },
      );
    }

    const clientId = form.get('clientId');
    if (typeof clientId !== 'string' || clientId === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'clientId is required' } },
        { status: 400 },
      );
    }

    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'At least one non-empty file is required' } },
        { status: 400 },
      );
    }

    const client = await getClient(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }

    const slug = clientSlug(client.name);
    const now = new Date();
    const results: UploadedFileResult[] = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const objectKey = buildUploadKey(slug, file.name, now);
      const mimeType = file.type === '' ? null : file.type;

      await putObject(objectKey, bytes, mimeType ?? undefined);
      const documentId = await insertUploadDocument({
        clientId,
        r2Key: objectKey,
        fileName: file.name,
        fileSize: bytes.byteLength,
      });
      const jobId = await enqueueIngest({
        documentId,
        clientId,
        objectKey,
        fileName: file.name,
        mimeType,
      });

      results.push({ documentId, objectKey, fileName: file.name, jobId });
    }

    return NextResponse.json({ documents: results }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'upload_failed', message } }, { status: 500 });
  }
}
