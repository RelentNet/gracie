/**
 * GET /api/documents?clientId=… — list documents, optionally scoped to a client.
 *
 * SECURITY-CRITICAL (docs/02 §D14, docs/08 §1/§7): documents that live in a
 * restricted-visibility folder (e.g. Transcripts) are OMITTED entirely for
 * non-admins. The route resolves which folders the role may see
 * (`filterVisibleFolders`) and drops any document whose `folderId` is not in that
 * set (`filterVisibleDocuments`) — restricted documents never reach the response.
 * Auth currently resolves to the mock user via getRequestUser() — replaced by
 * Logto JWT verification later.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import {
  filterVisibleDocuments,
  filterVisibleFolders,
  listDocuments,
  listFolders,
} from '@/lib/data/documents';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const clientId = request.nextUrl.searchParams.get('clientId') ?? undefined;

    const [documents, folders] = await Promise.all([
      listDocuments({ clientId }),
      listFolders(clientId),
    ]);

    const visibleFolders = filterVisibleFolders(folders, admin);
    const payload = filterVisibleDocuments(documents, visibleFolders, admin);

    return NextResponse.json({ documents: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'documents_list_failed', message } },
      { status: 500 },
    );
  }
}
