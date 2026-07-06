/**
 * POST /api/calendar/meetings/:id/orgs — link or unlink an existing org to a
 * meeting (P4.1, docs/plan §6). Body: `{ clientId, action: 'link' | 'unlink' }`.
 * Writes the `meeting_clients` junction and recomputes the primary `client_id`.
 * Editor tier (admin + standard); viewers are read-only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { linkMeetingOrg, unlinkMeetingOrg } from '@/lib/data/calendar';

interface OrgsBody {
  readonly clientId?: unknown;
  readonly action?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Editor access required' } },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as OrgsBody;
    if (typeof body.clientId !== 'string' || (body.action !== 'link' && body.action !== 'unlink')) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'clientId and action (link|unlink) are required' } },
        { status: 400 },
      );
    }

    if (body.action === 'link') await linkMeetingOrg(id, body.clientId);
    else await unlinkMeetingOrg(id, body.clientId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' || message === 'Unknown meeting' ? 404 : 500;
    return NextResponse.json({ error: { code: 'calendar_orgs_failed', message } }, { status });
  }
}
