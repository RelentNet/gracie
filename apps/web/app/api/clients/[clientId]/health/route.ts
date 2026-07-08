/**
 * GET    /api/clients/:clientId/health — relationship-health detail (score, trend,
 *        freshness, the latest computed breakdown, and admin per-signal adjustments).
 *        Any authenticated user (client.view) — the breakdown is not admin-only data.
 * POST   /api/clients/:clientId/health { signal, value, reason } — set an admin
 *        adjustment on one signal (ADMIN only). Enqueues a recompute so the override
 *        takes effect on the score.
 * DELETE /api/clients/:clientId/health?signal=… — clear an admin adjustment (ADMIN only).
 *
 * The score itself is PURELY COMPUTED by the worker; adjustments only override an
 * individual signal's input value (docs/plan/p2.1-stage-a-plan.md §2, Q2).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { HEALTH_SIGNAL_KEYS } from '@gracie/shared';
import type { HealthSignalKey } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import {
  clearHealthAdjustment,
  getClientHealth,
  setHealthAdjustment,
} from '@/lib/data/client-health';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { enqueueRelationshipHealth } from '@/lib/queue';

// bullmq/ioredis (the recompute enqueue) are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

function isSignal(value: unknown): value is HealthSignalKey {
  return typeof value === 'string' && (HEALTH_SIGNAL_KEYS as readonly string[]).includes(value);
}

function adminOnly(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: 'client_not_found', message: 'Client not found' } },
    { status: 404 },
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    await getRequestUser();
    const { clientId } = await params;
    const health = await getClientHealth(clientId);
    if (health === null) return notFound();
    return NextResponse.json({ health });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'client_health_failed', message } }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isAdmin(user)) return adminOnly();
    const { clientId } = await params;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isSignal(body.signal)) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A valid signal is required.' } },
        { status: 400 },
      );
    }
    if (
      typeof body.value !== 'number' ||
      !Number.isFinite(body.value) ||
      body.value < 0 ||
      body.value > 100
    ) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Value must be between 0 and 100.' } },
        { status: 400 },
      );
    }
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A reason is required.' } },
        { status: 400 },
      );
    }

    const byUserId = await getUserIdByLogtoId(user.userId);
    const adjustments = await setHealthAdjustment(
      clientId,
      body.signal,
      Math.round(body.value),
      body.reason,
      byUserId,
    );
    try {
      await enqueueRelationshipHealth(clientId, 'health-adjust');
    } catch (enqueueError) {
      console.warn('health POST: recompute enqueue failed', enqueueError);
    }
    return NextResponse.json({ adjustments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' ? 404 : 500;
    return NextResponse.json({ error: { code: 'client_health_failed', message } }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return adminOnly();
    const { clientId } = await params;
    const signal = request.nextUrl.searchParams.get('signal');
    if (!isSignal(signal)) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A valid signal is required.' } },
        { status: 400 },
      );
    }
    const adjustments = await clearHealthAdjustment(clientId, signal);
    try {
      await enqueueRelationshipHealth(clientId, 'health-adjust');
    } catch (enqueueError) {
      console.warn('health DELETE: recompute enqueue failed', enqueueError);
    }
    return NextResponse.json({ adjustments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' ? 404 : 500;
    return NextResponse.json({ error: { code: 'client_health_failed', message } }, { status });
  }
}
