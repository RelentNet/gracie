/**
 * Admin-only Pipeline activity feed (§3.1). Returns the full fleet view: every
 * recent run (success / partial / failed / duplicate-skip) UNION the stuck or
 * in-progress meetings that have no run row (watchdog-flagged `needs_attention`,
 * bot-dispatched-but-no-transcript). Status filtering happens client-side on this
 * bounded list.
 *
 *   GET /api/pipeline/runs → `{ runs }`
 *
 * Gated on `pipeline.viewErrors` (admin tier); a non-admin receives 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { listPipelineFleet } from '@/lib/data/pipeline';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }
  if (!can(user.role, 'pipeline.viewErrors')) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
  }

  try {
    return NextResponse.json({ runs: await listPipelineFleet() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'pipeline_runs_read_failed', message } }, { status: 500 });
  }
}
