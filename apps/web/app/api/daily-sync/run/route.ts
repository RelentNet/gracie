/**
 * POST /api/daily-sync/run — enqueue a manual daily-sync run (P7 §6). Admin only.
 * The `source: 'manual'` run bypasses the 6 AM ET send-hour gate and generates +
 * emails immediately (allowlist-gated in the worker). Mirrors the calendar "Sync
 * now" affordance.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { enqueueDailySync } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const jobId = await enqueueDailySync({ source: 'manual' });
    return NextResponse.json({ ok: true, jobId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'daily_sync_run_failed', message } }, { status: 500 });
  }
}
