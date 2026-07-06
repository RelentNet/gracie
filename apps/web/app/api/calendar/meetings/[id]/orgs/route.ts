/**
 * POST /api/calendar/meetings/:id/orgs — link or unlink an existing org to a
 * meeting (P4.1, docs/plan §6). Body:
 *   `{ clientId, action: 'link' | 'unlink', registerDomains?: string[] }`.
 * Writes the `meeting_clients` junction and recomputes the primary `client_id`.
 * On `link`, any `registerDomains` (the meeting's unknown external domains) are
 * ALSO registered on the org + backfilled — so linking, say, a `us.ibm.com`
 * meeting to the IBM org teaches the org that domain and picks up its other
 * meetings. Editor tier (admin + standard); viewers are read-only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { linkMeetingOrg, unlinkMeetingOrg } from '@/lib/data/calendar';
import { addClientDomain } from '@/lib/data/clients';

interface OrgsBody {
  readonly clientId?: unknown;
  readonly action?: unknown;
  readonly registerDomains?: unknown;
}

/** Distinct non-empty strings from an unknown body field (else []). */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
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

    if (body.action === 'link') {
      await linkMeetingOrg(id, body.clientId);
      // Teach the org the meeting's unknown domain(s) and backfill (default-on in
      // the UI). Skipped for free-email/internal/already-taken domains by
      // addClientDomain; a taken domain surfaces as a clear 400.
      for (const domain of asStringArray(body.registerDomains)) {
        await addClientDomain(body.clientId, domain);
      }
    } else {
      await unlinkMeetingOrg(id, body.clientId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Unknown client/meeting → 404; clean validation sentences (domain rejects) →
    // 400; wrapped internal errors (`fn: detail`) → 500.
    const status =
      message === 'Unknown client' || message === 'Unknown meeting'
        ? 404
        : message.includes(': ')
          ? 500
          : 400;
    return NextResponse.json({ error: { code: 'calendar_orgs_failed', message } }, { status });
  }
}
