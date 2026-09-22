/**
 * Branding — the white-label identity (Settings → Company → Branding).
 *
 *   GET → the available presets plus what is currently selected (ANY authenticated
 *         user; every role renders the nav, so every role may read the brand).
 *   PUT → admin selects a preset and/or sets a product-name override.
 *
 * The preset id is validated against the closed `BRAND_PRESETS` list, so the value
 * that reaches the layout's `<style>` block is always one of ours — never arbitrary
 * text from the request.
 *
 * The logo itself is a separate surface (`/api/brand/logo`), unchanged.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isAdmin, requireRequestUser } from '@/lib/api-auth';
import { BRAND_PRESETS, resolveBrandPreset } from '@/lib/brand-presets';
import {
  getBrandPresetId,
  getBrandProductName,
  setBrandPresetId,
  setBrandProductName,
} from '@/lib/data/branding-settings';
import { getUserIdByLogtoId } from '@/lib/data/users';

// @gracie/db (service-role) needs the Node runtime.
export const runtime = 'nodejs';

/** A product name must be short enough to fit the nav and carry no markup. */
const MAX_NAME_LEN = 40;

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

export async function GET(): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;

  try {
    const [presetId, productName] = await Promise.all([
      getBrandPresetId(),
      getBrandProductName(),
    ]);
    const preset = resolveBrandPreset(presetId);
    return NextResponse.json({
      presetId: preset.id,
      productName: productName ?? preset.productName,
      /** Null when the name simply follows the preset — the panel shows a placeholder. */
      productNameOverride: productName,
      presets: BRAND_PRESETS.map((p) => ({
        id: p.id,
        productName: p.productName,
        tagline: p.tagline,
        swatch: p.swatch,
      })),
    });
  } catch (error) {
    console.error('GET /api/settings/branding', error);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not read branding' } },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;
  if (!isAdmin(user)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Admin only' } },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Body must be JSON');
  }
  const { presetId, productName } = (body ?? {}) as {
    presetId?: unknown;
    productName?: unknown;
  };

  if (presetId !== undefined) {
    if (typeof presetId !== 'string' || !BRAND_PRESETS.some((p) => p.id === presetId)) {
      return badRequest(`presetId must be one of: ${BRAND_PRESETS.map((p) => p.id).join(', ')}`);
    }
  }
  // '' is meaningful: it CLEARS the override so the name follows the preset again.
  let cleanName: string | undefined;
  if (productName !== undefined) {
    if (typeof productName !== 'string') return badRequest('productName must be a string');
    cleanName = productName.trim();
    if (cleanName.length > MAX_NAME_LEN) {
      return badRequest(`productName must be ${MAX_NAME_LEN} characters or fewer`);
    }
    // Keep it to a label: no control characters, no angle brackets.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f<>]/.test(cleanName)) {
      return badRequest('productName contains invalid characters');
    }
  }
  if (presetId === undefined && cleanName === undefined) {
    return badRequest('Nothing to update');
  }

  try {
    const actorId = await getUserIdByLogtoId(user.userId).catch(() => null);
    if (typeof presetId === 'string') await setBrandPresetId(presetId, actorId);
    if (cleanName !== undefined) await setBrandProductName(cleanName, actorId);

    const [nextPresetId, nextName] = await Promise.all([
      getBrandPresetId(),
      getBrandProductName(),
    ]);
    const preset = resolveBrandPreset(nextPresetId);
    return NextResponse.json({
      presetId: preset.id,
      productName: nextName ?? preset.productName,
      productNameOverride: nextName,
    });
  } catch (error) {
    console.error('PUT /api/settings/branding', error);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Could not save branding' } },
      { status: 500 },
    );
  }
}
