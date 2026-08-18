/**
 * Admin-only AI settings (Settings → AI). Reads/writes the active generation PROVIDER
 * + MODEL and (optionally) the selected provider's API key; the embedding model is
 * pinned to OpenAI (D9) and returned read-only.
 *
 *   GET   → `{ settings: { provider, model, providers[], defaults…, embeddingModel } }`
 *   PATCH → `{ provider, model, apiKey? }` → `{ settings }`
 *
 * Both are Admin only; a non-admin receives 403 on read AND write.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { AiSettingsValidationError, getAiSettings, setAiProviderModel } from '@/lib/data/ai-settings';
import { getUserIdByLogtoId } from '@/lib/data/users';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
  try {
    return NextResponse.json({ settings: await getAiSettings() });
  } catch (error) {
    return jsonError('ai_settings_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.provider !== 'string') return jsonError('bad_request', 'provider (string) is required', 400);
    if (typeof body.model !== 'string') return jsonError('bad_request', 'model (string) is required', 400);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
    try {
      const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid (null if unsynced)
      return NextResponse.json({
        settings: await setAiProviderModel({ provider: body.provider, model: body.model, apiKey, updatedByUserId: byUserId }),
      });
    } catch (err) {
      if (err instanceof AiSettingsValidationError) return jsonError('bad_request', err.message, 400);
      throw err;
    }
  } catch (error) {
    return jsonError('ai_settings_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
