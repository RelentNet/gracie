/**
 * GET /api/documents/orgs — the orgs that ACTUALLY OWN a folder or document,
 * each with its display name, regardless of party type (internal, partner,
 * client, lead, prospect).
 *
 * Backs the global Documents tree + id→name map so internal/partner orgs (e.g.
 * the internal Grace & Associates workspace, which owns generated meeting docs)
 * are reachable as nodes and named correctly instead of "Unknown Client"
 * (docs/plan documents-area bugs). Deliberately type-agnostic — unlike
 * `GET /api/clients`, which defaults to real `client`s and excludes internal.
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { listDocumentOwnerOrgs } from '@/lib/data/documents';

export async function GET(): Promise<NextResponse> {
  try {
    await getRequestUser();
    const orgs = await listDocumentOwnerOrgs();
    return NextResponse.json({ orgs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'document_orgs_list_failed', message } },
      { status: 500 },
    );
  }
}
