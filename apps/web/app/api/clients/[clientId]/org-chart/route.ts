/**
 * An org's visual org chart (phase `CO`).
 *   GET /api/clients/:clientId/org-chart → { chart: OrgChart }
 * The office reports-to tree (`roots`) with each node's current holder (or null =
 * VACANT), plus a flat holder-enriched list (`offices`) for the reports-to picker.
 * Read gate (`contacts.view`, all roles).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireViewer } from '@/lib/contacts-api';
import { getOrgChart } from '@/lib/data/contacts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { clientId } = await params;
    const chart = await getOrgChart(clientId);
    return NextResponse.json({ chart });
  } catch (error) {
    return fail(error, 'org_chart_failed');
  }
}
