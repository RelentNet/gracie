/**
 * PATCH /api/clients/:clientId — edit a client's fields (P2.1).
 *
 * Editor tier (admin + standard); viewers are read-only. The admin-only fee fields
 * (`feeTier`, `contractValue`, `billingCadence`) may be edited ONLY by an admin — a
 * non-admin body carrying any of them is rejected 403 (mirrors `redactClientForRole`
 * on write; the data layer also strips them as defense-in-depth). Returns the
 * role-redacted, updated client. A cadence change enqueues a best-effort health
 * recompute (Redis-down never fails the edit — the nightly sweep is the backstop).
 */
import { NextResponse } from 'next/server';

import { CLIENT_CADENCES, CLIENT_TYPES, FEE_TIERS } from '@gracie/shared';
import type { ClientCadence, ClientType, FeeTier } from '@gracie/shared';

import { getRequestUser, isAdmin, isEditor } from '@/lib/api-auth';
import { redactClientForRole, updateClient, type ClientPatch } from '@/lib/data/clients';
import { enqueueRelationshipHealth } from '@/lib/queue';

// bullmq/ioredis (the recompute enqueue) are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

/** A nullable-text field is absent, a string, or explicit null (to clear); anything else is invalid. */
function readNullableText(
  body: Record<string, unknown>,
  key: string,
): { ok: true; present: boolean; value: string | null } | { ok: false } {
  if (!(key in body) || body[key] === undefined) return { ok: true, present: false, value: null };
  const raw = body[key];
  if (raw === null) return { ok: true, present: true, value: null };
  if (typeof raw === 'string') return { ok: true, present: true, value: raw };
  return { ok: false };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isEditor(user)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Editor access required' } },
        { status: 403 },
      );
    }
    const admin = isAdmin(user);
    const { clientId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};

    if ('name' in body && body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') return bad('Name cannot be empty.');
      patch.name = body.name;
    }
    if ('initials' in body && body.initials !== undefined) {
      if (typeof body.initials !== 'string' || body.initials.trim() === '') {
        return bad('Initials cannot be empty.');
      }
      patch.initials = body.initials;
    }
    if ('type' in body && body.type !== undefined) {
      if (typeof body.type !== 'string' || !(CLIENT_TYPES as readonly string[]).includes(body.type)) {
        return bad('Invalid client type.');
      }
      if (body.type === 'internal') return bad('The internal workspace type cannot be set manually.');
      patch.type = body.type as ClientType;
    }
    if ('cadence' in body && body.cadence !== undefined) {
      if (
        typeof body.cadence !== 'string' ||
        !(CLIENT_CADENCES as readonly string[]).includes(body.cadence)
      ) {
        return bad('Invalid cadence.');
      }
      patch.cadence = body.cadence as ClientCadence;
    }

    for (const key of ['primaryContact', 'contractNumber', 'description'] as const) {
      const field = readNullableText(body, key);
      if (!field.ok) return bad(`Invalid value for ${key}.`);
      if (field.present) patch[key] = field.value;
    }

    const email = readNullableText(body, 'primaryContactEmail');
    if (!email.ok) return bad('Invalid value for primaryContactEmail.');
    if (email.present) {
      if (email.value !== null && email.value.trim() !== '' && !EMAIL_RE.test(email.value.trim())) {
        return bad('Enter a valid email address.');
      }
      patch.primaryContactEmail = email.value;
    }

    const drive = readNullableText(body, 'driveFolderUrl');
    if (!drive.ok) return bad('Invalid value for driveFolderUrl.');
    if (drive.present) {
      if (drive.value !== null && drive.value.trim() !== '' && !/^https?:\/\//i.test(drive.value.trim())) {
        return bad('Enter a valid URL (starting with http:// or https://).');
      }
      patch.driveFolderUrl = drive.value;
    }

    // Admin-only fee fields — a non-admin may not touch them via any path.
    const feeKeys = ['feeTier', 'contractValue', 'billingCadence'] as const;
    const touchesFee = feeKeys.some((k) => k in body && body[k] !== undefined);
    if (touchesFee && !admin) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Financial fields are admin-only.' } },
        { status: 403 },
      );
    }
    if (admin) {
      if ('feeTier' in body && body.feeTier !== undefined) {
        if (body.feeTier !== null && !(FEE_TIERS as readonly string[]).includes(body.feeTier as string)) {
          return bad('Invalid fee tier.');
        }
        patch.feeTier = body.feeTier as FeeTier | null;
      }
      if ('contractValue' in body && body.contractValue !== undefined) {
        if (
          body.contractValue !== null &&
          !(typeof body.contractValue === 'number' && Number.isFinite(body.contractValue) && body.contractValue >= 0)
        ) {
          return bad('Contract value must be a non-negative number.');
        }
        patch.contractValue = body.contractValue as number | null;
      }
      const billing = readNullableText(body, 'billingCadence');
      if (!billing.ok) return bad('Invalid value for billingCadence.');
      if (billing.present) patch.billingCadence = billing.value;
    }

    if (Object.keys(patch).length === 0) return bad('No editable fields provided.');

    const updated = await updateClient(clientId, patch as ClientPatch, { isAdmin: admin });

    if (patch.cadence !== undefined) {
      // Cadence drives the health algorithm — refresh it. Best-effort.
      try {
        await enqueueRelationshipHealth(clientId, 'client-edit');
      } catch (enqueueError) {
        console.warn('client PATCH: health recompute enqueue failed', enqueueError);
      }
    }

    return NextResponse.json({ client: redactClientForRole(updated, admin) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' ? 404 : 500;
    return NextResponse.json({ error: { code: 'client_update_failed', message } }, { status });
  }
}
