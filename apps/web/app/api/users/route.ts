/**
 * GET /api/users — assignable users ({id, name, initials}) for owner/assignee
 * pickers. Any authenticated user may read it (owner names must render for
 * viewers too); it exposes NO role/email/status. This is the non-admin sibling of
 * the admin-only `GET /api/settings/users`, so a standard editor can populate the
 * Task Board's assign picker.
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { listAssignableUsers } from '@/lib/data/users';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    await getRequestUser();
  } catch {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    );
  }
  try {
    const users = await listAssignableUsers();
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'users_list_failed', message } }, { status: 500 });
  }
}
