/**
 * Admin-only generation-prompt settings (Settings → Generation Prompts, PE).
 * Reads/writes the per-document prompt overrides (`generation_prompt_overrides`).
 *
 *   GET   → `{ docs }` — the six docs with default + effective prompt (in order)
 *   PATCH → `{ overrides: { [docType]: string } }` → `{ docs }`
 *
 * Both Admin only (mirrors the Company route); a non-admin receives 403 on read
 * AND write. A blank / unchanged-from-default value resets that doc to its default.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import {
  GenerationPromptsValidationError,
  getGenerationPrompts,
  setGenerationPromptOverrides,
} from '@/lib/data/generation-prompts';

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
    return NextResponse.json({ docs: await getGenerationPrompts() });
  } catch (error) {
    return jsonError('generation_prompts_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
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
    const overrides = body.overrides;
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return jsonError('bad_request', 'overrides must be an object of { docType: string }', 400);
    }

    try {
      const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid (null if unsynced)
      const docs = await setGenerationPromptOverrides(overrides as Record<string, unknown>, byUserId);
      return NextResponse.json({ docs });
    } catch (err) {
      if (err instanceof GenerationPromptsValidationError) return jsonError('bad_request', err.message, 400);
      throw err;
    }
  } catch (error) {
    return jsonError('generation_prompts_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
