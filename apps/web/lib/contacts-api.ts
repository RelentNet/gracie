/**
 * Shared helpers for the Contacts & Org Charts API routes (phase `CO`).
 *
 * Keeps the many `/api/contacts/**` + `/api/clients/[id]/{offices,org-chart}/**`
 * routes terse and consistent: one auth-gate + one error-mapper, mirroring the
 * `fail()`/`forbidden()` convention of api/clients/[clientId]/domains/route.ts.
 */
import 'server-only';

import { NextResponse } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser, isEditor, type RequestUser } from './api-auth';
import { getSessionUser } from './session-user';

/** 403 for a failed permission gate. */
export function forbidden(message = 'Editor access required'): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message } }, { status: 403 });
}

/** 400 for a malformed request body / query. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

/** Coerce a request-body value to a trimmed non-empty string, or null. */
export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Map a thrown error to a response. Bare `Unknown …` sentences → 404; any wrapped
 * internal error (`fn: detail`, contains `': '`) → 500; a clean validation sentence
 * → 400. Matches how the data layer throws.
 */
export function fail(error: unknown, code = 'contacts_failed'): NextResponse {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = message.startsWith('Unknown ') ? 404 : message.includes(': ') ? 500 : 400;
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Resolve the caller and enforce read access (`contacts.view`, all roles). Returns
 * the user, or a `NextResponse` to return immediately when unauthorized.
 */
export async function requireViewer(): Promise<RequestUser | NextResponse> {
  const user = await getRequestUser();
  if (!can(user.role, 'contacts.view')) return forbidden('Access denied');
  return user;
}

/**
 * Resolve the caller and enforce editor access (`contacts.edit`, admin + standard).
 * Returns the user, or a `NextResponse` to return immediately when unauthorized.
 */
export async function requireEditor(): Promise<RequestUser | NextResponse> {
  const user = await getRequestUser();
  if (!isEditor(user)) return forbidden();
  return user;
}

/**
 * Best-effort real `users.id` for provenance (created_by / resolved_by), or null when
 * the session maps to no `users` row (e.g. local mock auth). Never hard-fails a write —
 * the columns are `on delete set null` and accept null.
 */
export async function optionalActorId(): Promise<string | null> {
  try {
    return (await getSessionUser()).id;
  } catch {
    return null;
  }
}
