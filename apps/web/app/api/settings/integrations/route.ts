/**
 * GET /api/settings/integrations — list manageable integrations with status
 * (docs/05 API Settings). Admin only. Returns NO secret values — only `isSet`,
 * non-secret `config`, and last Test Connection status.
 */
import { NextResponse } from 'next/server';

import { listIntegrations } from '@gracie/db';

import { getRequestUser, isAdmin } from '@/lib/api-auth';

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin only' } },
        { status: 403 },
      );
    }
    const integrations = await listIntegrations();
    return NextResponse.json({ integrations });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'integrations_list_failed', message } },
      { status: 500 },
    );
  }
}
