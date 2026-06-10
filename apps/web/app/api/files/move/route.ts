/**
 * POST /api/files/move { sourceKey, destinationKey }
 *
 * Server-side move = copy + delete (invisible to the user), then update the
 * matching `documents.r2_key`. Editor (admin/standard) only. Both source and
 * destination paths are authorized against folder visibility first.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { moveObject } from '@gracie/shared/storage';

import { getServerClient } from '@gracie/db';
import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canAccessKey, canEditRole } from '@/lib/data/files';

interface MoveBody {
  readonly sourceKey?: string;
  readonly destinationKey?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Move requires editor role' } },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as MoveBody;
    const { sourceKey, destinationKey } = body;
    if (
      sourceKey === undefined ||
      sourceKey === '' ||
      destinationKey === undefined ||
      destinationKey === ''
    ) {
      return NextResponse.json(
        {
          error: {
            code: 'bad_request',
            message: 'sourceKey and destinationKey are required',
          },
        },
        { status: 400 },
      );
    }

    const admin = isAdmin(user);
    const [srcOk, dstOk] = await Promise.all([
      canAccessKey(sourceKey, admin),
      canAccessKey(destinationKey, admin),
    ]);
    if (!srcOk || !dstOk) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for one of the paths' } },
        { status: 403 },
      );
    }

    await moveObject(sourceKey, destinationKey);

    // Update the document record's r2_key if one matches the source.
    const db = getServerClient();
    const { error } = await db
      .from('documents')
      .update({ r2_key: destinationKey })
      .eq('r2_key', sourceKey);
    if (error) throw new Error(`move record update: ${error.message}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'move_failed', message } }, { status: 500 });
  }
}
