/**
 * GET /api/daily-sync — the Today + Yesterday daily-sync digests (P7 §6). Any
 * authenticated role (the digest is firm-wide, not per-user). Used to refresh the
 * Daily Sync page after a manual "Generate now".
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { getTodayAndYesterday } from '@/lib/data/daily-sync';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    await getRequestUser();
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }
  try {
    const syncs = await getTodayAndYesterday();
    return NextResponse.json(syncs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'daily_sync_failed', message } }, { status: 500 });
  }
}
