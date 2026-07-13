/**
 * Admin-only company settings (Settings → Company, P9). Reads/writes the firm
 * description (`ga_company_description`) + the internal email domains
 * (`internal_email_domains`). The internal-domain floor can't be removed.
 *
 *   GET   → `{ settings: { companyDescription, internalDomains, floorDomains } }`
 *   PATCH → `{ companyDescription?, internalDomains? }` → `{ settings }`
 *
 * Both are Admin only; a non-admin receives 403 on read AND write.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import {
  CompanySettingsValidationError,
  getCompanySettings,
  setCompanySettings,
  type CompanySettingsPatch,
} from '@/lib/data/company-settings';

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
    return NextResponse.json({ settings: await getCompanySettings() });
  } catch (error) {
    return jsonError('company_settings_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
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

    const patch: { companyDescription?: string; internalDomains?: string[] } = {};

    if (body.companyDescription !== undefined) {
      if (typeof body.companyDescription !== 'string') {
        return jsonError('bad_request', 'companyDescription must be a string', 400);
      }
      patch.companyDescription = body.companyDescription;
    }

    if (body.internalDomains !== undefined) {
      if (!Array.isArray(body.internalDomains) || body.internalDomains.some((d) => typeof d !== 'string')) {
        return jsonError('bad_request', 'internalDomains must be an array of strings', 400);
      }
      patch.internalDomains = body.internalDomains as string[];
    }

    if (patch.companyDescription === undefined && patch.internalDomains === undefined) {
      return jsonError('bad_request', 'Provide companyDescription and/or internalDomains', 400);
    }

    try {
      const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid (null if unsynced)
      const settings = await setCompanySettings(patch as CompanySettingsPatch, byUserId);
      return NextResponse.json({ settings });
    } catch (err) {
      if (err instanceof CompanySettingsValidationError) return jsonError('bad_request', err.message, 400);
      throw err;
    }
  } catch (error) {
    return jsonError('company_settings_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
