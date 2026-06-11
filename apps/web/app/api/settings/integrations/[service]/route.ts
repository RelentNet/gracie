/**
 * PUT /api/settings/integrations/:service — set/replace the encrypted secret
 * and/or non-secret config. Body: { secret?, config? }. Returns status only.
 * DELETE — remove the stored secret (resolution falls back to env). Admin only
 * (docs/05 API Settings). Secrets are write-only: never returned to the client.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { clearIntegrationSecret, isManageableService, setIntegration, type Json } from '@gracie/db';

import { getRequestUser, isAdmin } from '@/lib/api-auth';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

function unknownService(service: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'unknown_service', message: `Not a manageable integration: ${service}` } },
    { status: 400 },
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ service: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const { service } = await params;
    if (!isManageableService(service)) return unknownService(service);

    const body = (await req.json().catch(() => ({}))) as { secret?: string; config?: Json };
    const secret = typeof body.secret === 'string' ? body.secret : undefined;
    if (secret === undefined && body.config === undefined) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Provide a secret and/or config.' } },
        { status: 400 },
      );
    }
    // updated_by_user_id left null for now — mapping the Logto sub to users.id is
    // a follow-up (TODO: resolve via users.logto_id).
    await setIntegration(service, { secret, config: body.config });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'integration_set_failed', message } }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ service: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const { service } = await params;
    if (!isManageableService(service)) return unknownService(service);
    await clearIntegrationSecret(service);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'integration_clear_failed', message } },
      { status: 500 },
    );
  }
}
