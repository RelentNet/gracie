/**
 * GET /api/calendar/cadence — per-client cadence tracker: last meeting, next
 * scheduled meeting, and overdue flag (docs/05, docs/08 §M7). Any role.
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { listClientCadence } from '@/lib/data/calendar';

export async function GET(): Promise<NextResponse> {
  try {
    await getRequestUser();
    const cadence = await listClientCadence();
    return NextResponse.json({ cadence });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'calendar_cadence_failed', message } }, { status: 500 });
  }
}
