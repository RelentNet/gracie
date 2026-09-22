import { NextResponse } from 'next/server';

import { brandPresetCss, resolveBrandPreset } from '@/lib/brand-presets';
import {
  getBrandLogoDarkKey,
  getBrandLogoKey,
  getBrandPresetId,
  getBrandProductName,
} from '@/lib/data/branding-settings';
import { getHealthScoresVisible } from '@/lib/data/scoring-settings';
import { getTaskBoardVisibleToAll } from '@/lib/data/tasks';
import { isLogtoConfigured } from '@/lib/logto';
import { getCurrentUser } from '@/lib/server-auth';
import { GUEST_USER } from '@/lib/auth-shared';

/** The active white-label identity; a settings-read blip → the default preset. */
async function activeBrand(): Promise<{ presetId: string; productName: string; css: string }> {
  const [presetId, nameOverride] = await Promise.all([
    getBrandPresetId().catch(() => null),
    getBrandProductName().catch(() => null),
  ]);
  const preset = resolveBrandPreset(presetId);
  return {
    presetId: preset.id,
    productName: nameOverride ?? preset.productName,
    // Hex/rgba from a closed preset list, never user input.
    css: brandPresetCss(preset),
  };
}

/**
 * GET /api/bootstrap — what the app shell needs before it renders: the signed-in user
 * plus the firm-wide display settings the nav and pages gate on. This is exactly what
 * the Next.js root layout resolved on every page load; the SPA fetches it once at
 * startup and again on `refresh()`.
 *
 * 401 when Logto is configured and there is no valid session — the SPA turns that
 * into a redirect to /login (the old app-shell guard).
 */
export async function GET(): Promise<NextResponse> {
  // A settings-read blip must never fail the whole app — fail OPEN to visible (the
  // current behavior), matching the missing-value default. A logo-read blip falls
  // back to null → the nav's default text treatment.
  const [user, healthScoresVisible, taskBoardVisibleToAll, brandLogoKey, brandLogoDarkKey, brand] =
    await Promise.all([
      getCurrentUser(),
      getHealthScoresVisible().catch(() => true),
      // Fall back to the default (admin-only) on a read blip — never reveal the board on error.
      getTaskBoardVisibleToAll().catch(() => false),
      getBrandLogoKey().catch(() => null),
      getBrandLogoDarkKey().catch(() => null),
      activeBrand(),
    ]);

  if (isLogtoConfigured() && user.id === GUEST_USER.id) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  return NextResponse.json({
    user,
    healthScoresVisible,
    taskBoardVisibleToAll,
    brandLogoKey,
    brandLogoDarkKey,
    brand,
  });
}
