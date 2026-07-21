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

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import { getClient } from '@/lib/data/clients';
import { getFolderById } from '@/lib/data/folders';
import { getUserIdByLogtoId } from '@/lib/data/users';
import {
  buildUploadKey,
  clientSlug,
  ensureUploadFolder,
  insertUploadDocument,
} from '@/lib/data/uploads';
import { resolveSubtype } from '@/lib/upload-subtypes';
import { enqueueIngest } from '@/lib/queue';

import type { DocumentStatus } from '@gracie/shared';

// bullmq/ioredis are Node-only — force the Node.js runtime (not edge).
export const runtime = 'nodejs';

interface UploadedFileResult {
  readonly documentId: string;
  readonly objectKey: string;
  readonly fileName: string;
  readonly jobId: string;
}

/** Read a trimmed non-empty string form field, or null. */
function readString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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

    // Destination inputs: the currently-viewed folder (explicit target) wins over
    // the document-type subtype, which only picks a default Uploads folder.
    const targetFolderId = readString(form.get('folderId'));
    const subtype = resolveSubtype(readString(form.get('subtype')));
    const status: DocumentStatus =
      readString(form.get('status')) === 'needs_review' ? 'needs_review' : 'ready';
    const titleOverride = readString(form.get('title'));

    const client = await getClient(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const slug = clientSlug(client.name);

    // Resolve the destination folder + its R2 prefix.
    let folderId: string;
    let folderPath: string;
    if (targetFolderId !== null) {
      // Upload into the folder the user is viewing.
      const folder = await getFolderById(targetFolderId);
      if (folder === null || folder.clientId !== clientId) {
        return NextResponse.json(
          { error: { code: 'bad_request', message: 'Invalid target folder' } },
          { status: 400 },
        );
      }
      // SECURITY (docs/02 §D14): the destination folder's visibility governs —
      // only admins may upload into a restricted (Admin-only) folder.
      if (folder.visibility === 'restricted' && !isAdmin(user)) {
        return NextResponse.json(
          { error: { code: 'forbidden', message: 'Not authorized for the destination folder' } },
          { status: 403 },
        );
      }
      folderId = folder.id;
      folderPath = folder.path;
    } else {
      // No folder selected → fall back to the client's Uploads folder by subtype.
      // SECURITY: filing a transcript into the Admin-only folder requires admin.
      if (subtype.restricted && !isAdmin(user)) {
        return NextResponse.json(
          { error: { code: 'forbidden', message: 'Filing into Transcripts requires admin' } },
          { status: 403 },
        );
      }
      const ensured = await ensureUploadFolder(clientId, slug, subtype.value);
      folderId = ensured.folderId;
      folderPath = ensured.folderPath;
    }
    // Stamp the uploader so `file.deleteOwn` can be enforced later. Resolve the
    // INTERNAL users.id — `user.userId` is the Logto subject, which is not what the
    // FK points at. Best-effort: a failed lookup leaves the column null (system-owned,
    // admin-deletable) rather than failing the upload.
    const uploadedByUserId = await getUserIdByLogtoId(user.userId).catch(() => null);
    const now = new Date();
    const results: UploadedFileResult[] = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const objectKey = buildUploadKey(folderPath, file.name, now);
      const mimeType = file.type === '' ? null : file.type;
      // A title override renames a single upload; multi-file batches keep names.
      const fileName =
        files.length === 1 && titleOverride !== null ? titleOverride : file.name;

      await putObject(objectKey, bytes, mimeType ?? undefined);
      const documentId = await insertUploadDocument({
        clientId,
        folderId,
        r2Key: objectKey,
        fileName,
        fileSize: bytes.byteLength,
        status,
        uploadedByUserId,
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
