/**
 * GET /api/clients/:clientId/strategy — Strategy tab data.
 *
 * Returns the role-redacted client (trajectory/health/cadence live on the
 * client row), the master-record chronology, and derived risk flags. Admin-only
 * client fields are gated by role (docs/02 §D14). Auth resolves to the mock user.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { redactClientForRole } from '@/lib/data/clients';
import { getClientDetail, getClientMasterRecord } from '@/lib/data/client-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const admin = isAdmin(await getRequestUser());
    const masterRecord = await getClientMasterRecord(clientId);
    const riskFlags: string[] = [];
    if (client.relationshipTrend === 'declining') {
      riskFlags.push('Relationship trend is declining — recommend an executive check-in.');
    }
    if (client.relationshipHealth !== null && client.relationshipHealth < 70) {
      riskFlags.push(`Relationship health below 70 (${client.relationshipHealth}).`);
    }
    return NextResponse.json({
      client: redactClientForRole(client, admin),
      masterRecord,
      riskFlags,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_strategy_failed', message } },
      { status: 500 },
    );
  }
}
