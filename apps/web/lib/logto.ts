/**
 * Logto configuration + role resolution (docs/07 §5, docs/02 D4).
 *
 * Server-only. Until the Logto application is created (admin first-run) the
 * bootstrap secrets are unset, `isLogtoConfigured()` returns false, and callers
 * fall back to a mock identity so local development keeps working without auth.
 * Once the `LOGTO_*` env vars are present, the same code path activates real
 * session verification with no further changes.
 */
import 'server-only';

import type { LogtoContext, LogtoNextConfig } from '@logto/next';

import { isRole, type Role } from '@gracie/shared';

const endpoint = process.env.LOGTO_ENDPOINT;
const appId = process.env.LOGTO_APP_ID;
const appSecret = process.env.LOGTO_APP_SECRET;
const cookieSecret = process.env.LOGTO_COOKIE_SECRET;

/** App origin Logto redirects back to after sign-in/out. */
export const baseUrl =
  process.env.LOGTO_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * True only when every bootstrap Logto secret is present. Gates all Logto calls
 * so the app degrades to the mock identity before the Logto app exists.
 */
export function isLogtoConfigured(): boolean {
  return Boolean(endpoint && appId && appSecret && cookieSecret);
}

/**
 * Logto Next config. Scopes include `roles` + `custom_data` so the app Role can
 * be resolved from either a custom `user_role`/`app_role` claim (preferred — set
 * via Logto's JWT customizer, read by the DB `auth_role()`) or Logto RBAC roles.
 */
export const logtoConfig: LogtoNextConfig = {
  endpoint: endpoint ?? '',
  appId: appId ?? '',
  appSecret: appSecret ?? '',
  baseUrl,
  cookieSecret: cookieSecret ?? '',
  cookieSecure: process.env.NODE_ENV === 'production',
  scopes: ['profile', 'email', 'roles', 'custom_data'],
};

/** Least-privilege default when no role claim is present. */
const DEFAULT_ROLE: Role = 'viewer';

/** Custom claim keys the DB `auth_role()` reads, in priority order. */
const ROLE_CLAIM_KEYS = ['user_role', 'app_role'] as const;

function roleFromValue(value: unknown): Role | null {
  return isRole(value) ? value : null;
}

function roleFromList(value: unknown): Role | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (isRole(entry)) return entry;
  }
  return null;
}

/**
 * Resolve the app Role from a Logto context, in order: the `user_role`/`app_role`
 * claim on the id token, the same key in userInfo, then Logto RBAC `roles`
 * arrays. Defaults to least privilege when nothing matches.
 */
export function resolveRole(context: LogtoContext): Role {
  const { claims, userInfo } = context;

  for (const key of ROLE_CLAIM_KEYS) {
    const fromClaim = roleFromValue(claims?.[key]) ?? roleFromValue(userInfo?.[key]);
    if (fromClaim !== null) return fromClaim;
  }

  return roleFromList(claims?.roles) ?? roleFromList(userInfo?.roles) ?? DEFAULT_ROLE;
}
