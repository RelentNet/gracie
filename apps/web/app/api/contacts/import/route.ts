/**
 * Outlook/Office 365 contacts import (admin-triggered).
 *   POST /api/contacts/import { mailbox }  → enqueue an import, returns { jobId }.
 *   GET  /api/contacts/import?jobId=       → poll the job's state + plain-language result.
 *
 * Admin only (matches the calendar "Sync now" gate — this reads a colleague's whole
 * mailbox). The worker does the Graph read + upsert; the modal polls GET for the
 * result string. A 403 from Graph (Contacts.Read not granted) comes back as a
 * completed job with `{ ok:false, reason:'permission_denied' }`, not a failure.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { enqueueOutlookContactsImport, getOutlookContactsImportStatus } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime (not edge).
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mailbox = typeof body.mailbox === 'string' ? body.mailbox.trim() : '';
    if (mailbox === '' || !mailbox.includes('@')) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A mailbox email address is required.' } },
        { status: 400 },
      );
    }
    const jobId = await enqueueOutlookContactsImport(mailbox);
    return NextResponse.json({ enqueued: true, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'import_enqueue_failed', message } }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const jobId = request.nextUrl.searchParams.get('jobId');
    if (jobId === null || jobId === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'jobId is required.' } },
        { status: 400 },
      );
    }
    const status = await getOutlookContactsImportStatus(jobId);
    if (status === null) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Unknown job' } }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'import_status_failed', message } }, { status: 500 });
  }
}
