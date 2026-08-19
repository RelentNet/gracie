/**
 * GET /api/settings/integrations — list manageable integrations with status
 * (docs/05 API Settings). Admin only. Returns NO secret values — only `isSet`,
 * non-secret `config`, and last Test Connection status.
 *
 * AI generation-provider keys (OpenAI, Anthropic, and every other AI-SDK provider) are
 * managed in Settings → AI Provider instead, so they are filtered OUT here to keep the
 * API Settings tab to non-AI integrations (Recall, Resend, object storage, MS Graph).
 */
import { NextResponse } from 'next/server';

import { listIntegrations } from '@gracie/db';
import { PROVIDER_IDS } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';

// Node-only (@gracie/db service-role client + @gracie/shared provider ids).
export const runtime = 'nodejs';

const AI_PROVIDER_SERVICES = new Set<string>(PROVIDER_IDS);

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin only' } },
        { status: 403 },
      );
    }
    const integrations = (await listIntegrations()).filter((i) => !AI_PROVIDER_SERVICES.has(i.service));
    return NextResponse.json({ integrations });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'integrations_list_failed', message } },
      { status: 500 },
    );
  }
}
