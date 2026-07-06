/**
 * POST /api/calendar/meetings/:id/create-org — create a client/prospect/lead/
 * partner from an unknown external domain on this meeting (P4.1, docs/plan §6).
 * Inserts the org + `client_domains`, links this meeting, and retroactively links
 * every other meeting on that domain. Rejects free-email / internal / taken
 * domains. Editor tier (admin + standard). Body:
 *   `{ domain, name?, type?, primaryContact?, primaryContactEmail? }`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { CLIENT_TYPES } from '@gracie/shared';
import type { ClientType } from '@gracie/shared';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { createOrgFromMeeting } from '@/lib/data/calendar';

function asType(value: unknown): ClientType | undefined {
  return typeof value === 'string' && (CLIENT_TYPES as readonly string[]).includes(value)
    ? (value as ClientType)
    : undefined;
}

function asTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const domain = asTrimmed(body.domain);
    if (domain === undefined) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A domain is required.' } },
        { status: 400 },
      );
    }

    const client = await createOrgFromMeeting({
      meetingId: id,
      domain,
      name: asTrimmed(body.name),
      type: asType(body.type),
      primaryContact: asTrimmed(body.primaryContact) ?? null,
      primaryContactEmail: asTrimmed(body.primaryContactEmail) ?? null,
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Validation-style failures (free-email, taken domain, unknown meeting) → 400/404.
    const status =
      message === 'Unknown meeting'
        ? 404
        : /domain|internal|organization|required/i.test(message)
          ? 400
          : 500;
    return NextResponse.json({ error: { code: 'calendar_create_org_failed', message } }, { status });
  }
}
