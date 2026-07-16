/**
 * POST /api/staff/upload — upload file(s) into the Gracie Files (GF) staff drive.
 *
 * Editor-only (admin/standard); Viewer → 403 (D14). Server-side receipt (the
 * frontend never holds MinIO creds): each file is stored under a `staff/…` object
 * key, a `documents` row is inserted with the internal GA org's `client_id`, the
 * target staff `folder_id`, and `uploaded_by_user_id` for attribution, and an
 * ingest job is enqueued — the SAME pipeline as client uploads, so staff files are
 * embedded (internal-org `client_id`, `source_type='upload'`) and become visible to
 * the company-aware Assistant. Restricted staff folders remain admin-only.
 *
 * Multipart form: `folderId` (target staff folder) + one or more `file` parts;
 * optional `title` (single-file rename) + `status`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { putObject } from '@gracie/shared/storage';
import type { DocumentStatus } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import { buildUploadKey, insertUploadDocument } from '@/lib/data/uploads';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { STAFF_ROOT, ensureStaffRoot, getStaffFolderById } from '@/lib/data/staff-drive';
import { enqueueIngest } from '@/lib/queue';

// bullmq/ioredis + storage are Node-only — force the Node.js runtime (not edge).
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

    const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'At least one non-empty file is required' } },
        { status: 400 },
      );
    }

    const status: DocumentStatus =
      readString(form.get('status')) === 'needs_review' ? 'needs_review' : 'ready';
    const titleOverride = readString(form.get('title'));

    const { orgId, rootFolderId } = await ensureStaffRoot();

    // Destination = the selected staff folder, or the `staff/` root when absent.
    const targetFolderId = readString(form.get('folderId'));
    let folderId = rootFolderId;
    let folderPath = STAFF_ROOT;
    if (targetFolderId !== null && targetFolderId !== rootFolderId) {
      const folder = await getStaffFolderById(targetFolderId);
      if (folder === null) {
        return NextResponse.json(
          { error: { code: 'bad_request', message: 'Invalid target folder' } },
          { status: 400 },
        );
      }
      // Only admins may upload into a restricted (Admin-only) folder.
      if (folder.visibility === 'restricted' && !isAdmin(user)) {
        return NextResponse.json(
          { error: { code: 'forbidden', message: 'Not authorized for the destination folder' } },
          { status: 403 },
        );
      }
      folderId = folder.id;
      folderPath = folder.path;
    }

    const uploadedByUserId = await getUserIdByLogtoId(user.userId);
    const now = new Date();
    const results: UploadedFileResult[] = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const objectKey = buildUploadKey(folderPath, file.name, now);
      const mimeType = file.type === '' ? null : file.type;
      const fileName = files.length === 1 && titleOverride !== null ? titleOverride : file.name;

      await putObject(objectKey, bytes, mimeType ?? undefined);
      const documentId = await insertUploadDocument({
        clientId: orgId,
        folderId,
        r2Key: objectKey,
        fileName,
        fileSize: bytes.byteLength,
        status,
        uploadedByUserId,
      });
      const jobId = await enqueueIngest({
        documentId,
        clientId: orgId,
        objectKey,
        fileName: file.name,
        mimeType,
      });

      results.push({ documentId, objectKey, fileName: file.name, jobId });
    }

    return NextResponse.json({ documents: results }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'staff_upload_failed', message } }, { status: 500 });
  }
}
