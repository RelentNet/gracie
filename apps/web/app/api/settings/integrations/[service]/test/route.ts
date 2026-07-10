/**
 * POST /api/settings/integrations/:service/test — Test Connection (docs/05).
 * Resolves the key via getCredential (stored → env), makes a lightweight live
 * call where implemented, records last_tested_at/last_test_ok, returns
 * { ok, message }. Admin only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getCredential, isManageableService, recordTestResult, type IntegrationKey } from '@gracie/db';

import { getRequestUser, isAdmin } from '@/lib/api-auth';

interface TestResult {
  readonly ok: boolean;
  readonly message: string;
}

async function testConnection(service: IntegrationKey, key: string): Promise<TestResult> {
  if (service === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok
      ? { ok: true, message: 'OpenAI key is valid.' }
      : { ok: false, message: `OpenAI rejected the key (HTTP ${res.status}).` };
  }
  if (service === 'resend') {
    // Lightweight live probe: listing domains validates the key without sending
    // any email (P7 §4). A valid key returns 200; an invalid one 401/403.
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok
      ? { ok: true, message: 'Resend key is valid.' }
      : { ok: false, message: `Resend rejected the key (HTTP ${res.status}).` };
  }
  // Other services: a live probe lands with each provider's phase. For now the
  // stored key is accepted as configured.
  return {
    ok: true,
    message: `Key stored. A live connection test for "${service}" is not implemented yet.`,
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ service: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin only' } },
        { status: 403 },
      );
    }
    const { service } = await params;
    if (!isManageableService(service)) {
      return NextResponse.json(
        { error: { code: 'unknown_service', message: `Not a manageable integration: ${service}` } },
        { status: 400 },
      );
    }

    const key = await getCredential(service);
    if (key === null || key === '') {
      await recordTestResult(service, false);
      return NextResponse.json({ ok: false, message: 'No API key is configured for this service.' });
    }

    const result = await testConnection(service, key);
    await recordTestResult(service, result.ok);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'integration_test_failed', message } }, { status: 500 });
  }
}
