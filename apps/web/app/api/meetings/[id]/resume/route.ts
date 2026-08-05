/**
 * POST /api/meetings/[id]/resume — RESUME Gracie's paused recording for this
 * meeting. Any authenticated user. Works on any bot, independent of the
 * transcript-provider setting. See {@link runBotControl}.
 */
import { NextResponse } from 'next/server';

import { resumeRecallBot } from '@gracie/shared/recall';

import { runBotControl } from '@/lib/meeting-bot-control';

// @gracie/db (service-role) + a synchronous outbound Recall call — Node only.
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return runBotControl(id, resumeRecallBot);
}
