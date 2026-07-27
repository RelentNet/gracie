/**
 * POST /api/daily-sync/run — enqueue a manual daily-sync run (P7 §6). Admin only.
 * The `source: 'manual'` run bypasses the 6 AM ET send-hour gate and generates +
 * emails immediately (allowlist-gated in the worker). Mirrors the calendar "Sync
 * now" affordance.
 *
 * Body `{ preview: true }` (DS) makes it a "send test to me": the run emails ONLY the
 * requesting admin and skips the delivered/brief stamps, so a preview never suppresses
 * the real 6 AM send. Used by the Daily Sync settings panel to see the rendered email
 * (including the `{ai_brief}` output) before trusting it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { enqueueDailySync } from '@/lib/queue';

// bullmq/ioredis are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.preview === true) {
      const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid
      if (byUserId === null) {
        return NextResponse.json(
          { error: { code: 'preview_unavailable', message: 'Your account is not fully synced yet — try again shortly.' } },
          { status: 400 },
        );
      }
      const jobId = await enqueueDailySync({ source: 'manual', previewRecipientUserId: byUserId });
      return NextResponse.json({ ok: true, jobId, preview: true }, { status: 202 });
    }

    const jobId = await enqueueDailySync({ source: 'manual' });
    return NextResponse.json({ ok: true, jobId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'daily_sync_run_failed', message } }, { status: 500 });
  }
}
