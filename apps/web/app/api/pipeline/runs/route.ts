/**
 * Admin-only pipeline error log (P9). Lists failed/partial `pipeline_runs` for the
 * Pipeline admin section.
 *
 *   GET /api/pipeline/runs?status=failed|partial → `{ runs }`
 *     - status omitted → both failed AND partial (the "needs attention" set)
 *
 * Gated on `pipeline.viewErrors` (admin tier); a non-admin receives 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { listPipelineRunErrors, type PipelineErrorStatus } from '@/lib/data/pipeline';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
  }
  if (!can(user.role, 'pipeline.viewErrors')) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
  }

  const statusParam = request.nextUrl.searchParams.get('status');
  const statuses: PipelineErrorStatus[] =
    statusParam === 'failed' ? ['failed'] : statusParam === 'partial' ? ['partial'] : ['failed', 'partial'];

  try {
    return NextResponse.json({ runs: await listPipelineRunErrors(statuses) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'pipeline_runs_read_failed', message } }, { status: 500 });
  }
}
