/**
 * POST /api/calendar/sync — trigger a one-off calendar scan ("Sync now"). Admin
 * only. Enqueues a `source: 'manual'` calendar-scan job, which the worker runs
 * immediately (bypassing the business-hours gate). The sweep reads the group's
 * calendars and upserts/reconciles `meetings`; the connection panel's "last
 * synced" time advances when it finishes.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { enqueueCalendarScan } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime (not edge).
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const jobId = await enqueueCalendarScan({ source: 'manual' });
    return NextResponse.json({ enqueued: true, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'calendar_sync_failed', message } }, { status: 500 });
  }
}
