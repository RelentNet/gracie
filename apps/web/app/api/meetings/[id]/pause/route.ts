/**
 * POST /api/meetings/[id]/pause — PAUSE Gracie's live recording for this meeting.
 * The bot stays in the call but stops capturing until resumed. Any authenticated
 * user. Works on any bot, independent of the transcript-provider setting. See
 * {@link runBotControl}.
 */
import { NextResponse } from 'next/server';

import { pauseRecallBot } from '@gracie/shared/recall';

import { runBotControl } from '@/lib/meeting-bot-control';

// @gracie/db (service-role) + a synchronous outbound Recall call — Node only.
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return runBotControl(id, pauseRecallBot);
}
