/**
 * GET /api/folders?clientId=… — list folders, optionally scoped to a client.
 *
 * SECURITY-CRITICAL (docs/02 §D14, docs/08 §1/§7): restricted-visibility folders
 * (e.g. Transcripts) are OMITTED entirely for non-admins via
 * `filterVisibleFolders` — they never reach the response. Auth currently resolves
 * to the mock user via getRequestUser() — replaced by Logto JWT verification later.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { filterVisibleFolders, listFolders } from '@/lib/data/documents';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const clientId = request.nextUrl.searchParams.get('clientId') ?? undefined;
    const folders = await listFolders(clientId);
    const payload = filterVisibleFolders(folders, admin);
    return NextResponse.json({ folders: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'folders_list_failed', message } },
      { status: 500 },
    );
  }
}
