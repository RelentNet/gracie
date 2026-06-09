/**
 * GET /api/files/url?key=<r2-key>&action=get|put
 *
 * Issues a short-lived presigned URL for a storage object. The folder path is
 * authorized against the `folders` table FIRST (docs/01 §2): if the key lives
 * under a restricted folder the role cannot see, access is denied. `put`
 * requires editor (admin/standard).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { presignGet, presignPut } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canAccessKey, canEditRole } from '@/lib/data/files';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    const action = searchParams.get('action') ?? 'get';

    if (key === null || key === '') {
      return NextResponse.json(
        { error: { code: 'missing_key', message: 'key query param is required' } },
        { status: 400 },
      );
    }
    if (action !== 'get' && action !== 'put') {
      return NextResponse.json(
        { error: { code: 'bad_action', message: "action must be 'get' or 'put'" } },
        { status: 400 },
      );
    }

    const user = getRequestUser();

    // Authorize the folder path for this role before signing anything.
    const allowed = await canAccessKey(key, isAdmin(user));
    if (!allowed) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for this path' } },
        { status: 403 },
      );
    }

    if (action === 'put' && !canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Upload requires editor role' } },
        { status: 403 },
      );
    }

    const url = action === 'get' ? await presignGet(key) : await presignPut(key);
    return NextResponse.json({ url, expiresInSeconds: 900 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'presign_failed', message } },
      { status: 500 },
    );
  }
}
